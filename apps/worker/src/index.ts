import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { upload, type HostSpec } from './hosts.js';
import { killAll, run } from './process.js';

/**
 * kahal.tools Podcast-Worker
 *
 * Holt Aufträge vom Server ab (Pull-Prinzip, keine offenen Ports nötig), lädt nur den benötigten
 * Ausschnitt der Audiospur von YouTube, kodiert MP3 und lädt es auf das Podcast-Hosting.
 * Ressourcensparend: nur Audio, nur der Ausschnitt, eine Kodierung, ein Auftrag gleichzeitig (Standard).
 */
const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? '';
const WORKER_ID = process.env.WORKER_ID ?? hostname();
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 1));
const POLL_MS = Number(process.env.POLL_INTERVAL_SECONDS ?? 20) * 1000;
const TMP_DIR = process.env.TMP_DIR ?? tmpdir();
const YTDLP = process.env.YTDLP_BIN ?? 'yt-dlp';
const YTDLP_COOKIES = process.env.YTDLP_COOKIES ?? '/data/cookies.txt';
const YTDLP_JS_RUNTIME = process.env.YTDLP_JS_RUNTIME ?? 'node';
// 6 = YouTube über IPv6 laden (Rechenzentrums-IPv4-Adressen werden oft als Bot blockiert), 4 = nur IPv4, leer = automatisch
const YTDLP_IP_VERSION = process.env.YTDLP_IP_VERSION ?? '';
// true = nur den Ausschnitt laden (yt-dlp schneidet über ffmpeg). Standard: ganze Audiospur mit dem eigenen
// Downloader von yt-dlp laden und lokal schneiden – robuster (IPv6, Drosselung, frisch beendete Livestreams).
const YTDLP_SECTIONS = process.env.YTDLP_SECTIONS === 'true';
const YTDLP_EXTRA_ARGS = (process.env.YTDLP_EXTRA_ARGS ?? '').split(' ').filter(Boolean);
const AUTO_UPDATE = process.env.YTDLP_AUTO_UPDATE !== 'false';

interface PodcastJob {
  id: string;
  type: string;
  attempt: number;
  payload: {
    podcastId: string;
    videoUrl: string;
    startSec: number;
    endSec: number;
    fileName: string;
    audio: { bitrate: string; mono: boolean; normalize: boolean };
    tags: Record<string, string>;
    imageUrl?: string | null;
    host: HostSpec;
  };
}

interface FeedJob {
  id: string;
  type: string;
  attempt: number;
  payload: { fileName: string; content: string; host: HostSpec };
}

const JOB_TYPES = ['podcast.render', 'podcast.feed'];

let stopping = false;
const activeJobs = new Set<string>();

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, body?: unknown) {
  const res = await fetch(`${SERVER_URL}/api/worker${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'X-Worker-Id': WORKER_ID, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return null;
  if (res.status === 401) throw new Error('Server lehnt das WORKER_TOKEN ab');
  return res.json().catch(() => null);
}

/** Fortschritt melden (gedrosselt). Dient gleichzeitig als Lebenszeichen für den Server. */
function progressReporter(jobId: string) {
  let last = 0;
  let lastValue = -1;
  return async (progress: number, message?: string, force = false) => {
    const now = Date.now();
    if (!force && (now - last < 10_000 || Math.round(progress) === lastValue)) return;
    last = now;
    lastValue = Math.round(progress);
    await api(`/jobs/${jobId}/progress`, { progress, message }).catch((err) => log('Fortschritt konnte nicht gemeldet werden:', err.message));
  };
}

function hms(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Dauer einer Mediendatei in Sekunden, 0 wenn sie kein lesbares Audio enthält */
async function probeDuration(file: string) {
  try {
    const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    const value = Number(out.trim().split('\n').pop());
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function processPodcast(job: PodcastJob) {
  const p = job.payload;
  const report = progressReporter(job.id);
  const dir = await mkdtemp(join(TMP_DIR, 'kahal-'));
  let lastProgress = 0;
  const step = (value: number, message: string) => {
    lastProgress = value;
    return report(value, message, true);
  };
  // Lebenszeichen auch während langer Schritte ohne Fortschrittsanzeige
  const keepAlive = setInterval(() => void report(lastProgress, undefined, true), 120_000);

  try {
    // 1) Audiospur laden (nur Audio, kein Video)
    await step(2, 'Audio wird von YouTube geladen');
    const args = ['--no-playlist', '--newline', '--progress', '-f', 'bestaudio[ext=m4a]/bestaudio/best', '-o', join(dir, 'source.%(ext)s')];
    if (YTDLP_SECTIONS) args.push('--download-sections', `*${hms(p.startSec)}-${hms(p.endSec)}`);
    if (YTDLP_JS_RUNTIME) args.push('--js-runtimes', YTDLP_JS_RUNTIME);
    if (existsSync(YTDLP_COOKIES)) args.push('--cookies', YTDLP_COOKIES);
    if (YTDLP_IP_VERSION === '6' || YTDLP_IP_VERSION === '4') args.push(`-${YTDLP_IP_VERSION}`);
    args.push(...YTDLP_EXTRA_ARGS, p.videoUrl);
    const totalSec = p.endSec - p.startSec;
    await run(YTDLP, args, (line) => {
      // ffmpeg-Ausgabe "time=00:12:34.56" oder yt-dlp "[download]  42.0%"
      const t = line.match(/time=(\d+):(\d+):(\d+)/);
      const pct = line.match(/\[download\]\s+([\d.]+)%/);
      const fraction = t ? (Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])) / totalSec : pct ? Number(pct[1]) / 100 : null;
      if (fraction !== null) {
        lastProgress = 2 + Math.min(1, fraction) * 48;
        void report(lastProgress, 'Audio wird von YouTube geladen');
      }
    });
    const source = (await readdir(dir)).find((f) => f.startsWith('source.'));
    if (!source) throw new Error('yt-dlp hat keine Audiodatei erzeugt');
    const sourceSec = await probeDuration(join(dir, source));
    if (!sourceSec) throw new Error('Die von YouTube geladene Audiodatei ist leer. Ist das Video schon vollständig verarbeitet (bei Livestreams einige Minuten nach Ende warten)?');
    if (!YTDLP_SECTIONS && p.startSec >= sourceSec) {
      throw new Error(`Der Startpunkt (${hms(p.startSec)}) liegt hinter dem Ende des Videos (${hms(Math.floor(sourceSec))})`);
    }

    // 2) Cover laden (optional)
    let cover: string | null = null;
    if (p.imageUrl) {
      try {
        const res = await fetch(p.imageUrl, { signal: AbortSignal.timeout(20_000) });
        if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) {
          cover = join(dir, 'cover.img');
          await writeFile(cover, Buffer.from(await res.arrayBuffer()));
        }
      } catch (err) {
        log('Cover konnte nicht geladen werden:', (err as Error).message);
      }
    }

    // 3) MP3 kodieren (inkl. Lautheitsnormalisierung und ID3-Tags)
    await step(52, 'MP3 wird erstellt');
    const out = join(dir, 'episode.mp3');
    const ff = ['-hide_banner', '-nostdin', '-y'];
    // Lokal schneiden; -ss vor -i springt direkt an die Stelle (bei Audio sample-genau)
    if (!YTDLP_SECTIONS) ff.push('-ss', String(p.startSec), '-t', String(totalSec));
    ff.push('-i', join(dir, source));
    if (cover) ff.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-vf', "scale='min(1400,iw)':-2", '-disposition:v', 'attached_pic');
    else ff.push('-map', '0:a');
    if (p.audio.normalize) ff.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    if (p.audio.mono) ff.push('-ac', '1');
    ff.push('-c:a', 'libmp3lame', '-b:a', p.audio.bitrate, '-ar', '44100', '-id3v2_version', '3');
    for (const [key, value] of Object.entries(p.tags)) if (value) ff.push('-metadata', `${key}=${value}`);
    ff.push(out);
    await run('ffmpeg', ff, (line) => {
      const t = line.match(/time=(\d+):(\d+):(\d+)/);
      if (t) {
        lastProgress = 52 + Math.min(1, (Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])) / totalSec) * 33;
        void report(lastProgress, 'MP3 wird erstellt');
      }
    });

    const durationSec = Math.round(await probeDuration(out));
    if (!durationSec) throw new Error('Die erstellte MP3-Datei enthält kein Audio. Bitte Start- und Endzeit prüfen.');
    const { size } = await stat(out);

    // 4) Hochladen
    await step(86, 'Upload auf den Podcast-Server');
    await upload(p.host, out, p.fileName, (fraction) => {
      lastProgress = 86 + fraction * 13;
      void report(lastProgress, 'Upload auf den Podcast-Server');
    });

    await api(`/jobs/${job.id}/complete`, { result: { fileSize: size, durationSec: Number.isFinite(durationSec) ? durationSec : undefined } });
    log(`Auftrag ${job.id} fertig (${(size / 1e6).toFixed(1)} MB, ${durationSec}s)`);
  } finally {
    clearInterval(keepAlive);
    await rm(dir, { recursive: true, force: true });
  }
}

/** feed.xml (vom Server erzeugt) auf das Podcast-Hosting laden */
async function processFeed(job: FeedJob) {
  const dir = await mkdtemp(join(TMP_DIR, 'kahal-'));
  try {
    const file = join(dir, 'feed.xml');
    await writeFile(file, job.payload.content, 'utf8');
    await upload(job.payload.host, file, job.payload.fileName, () => {});
    await api(`/jobs/${job.id}/complete`, { result: {} });
    log(`${job.payload.fileName} aktualisiert`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function handle(job: PodcastJob | FeedJob) {
  activeJobs.add(job.id);
  log(`Auftrag ${job.id} (${job.type}, Versuch ${job.attempt}) gestartet`);
  try {
    if (job.type === 'podcast.render') await processPodcast(job as PodcastJob);
    else if (job.type === 'podcast.feed') await processFeed(job as FeedJob);
    else throw new Error(`Unbekannter Auftragstyp ${job.type}`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    log(`Auftrag ${job.id} fehlgeschlagen:`, message);
    const retryable = !/Private video|Video unavailable|does not support|wird vom Worker nicht unterstützt/i.test(message);
    await api(`/jobs/${job.id}/fail`, { error: message, retryable }).catch(() => {});
  } finally {
    activeJobs.delete(job.id);
  }
}

async function slot(n: number) {
  while (!stopping) {
    try {
      const job = (await api('/claim', { types: JOB_TYPES })) as PodcastJob | FeedJob | null;
      if (job?.id) {
        await handle(job);
        continue;
      }
    } catch (err) {
      log(`[Slot ${n}] Server nicht erreichbar:`, (err as Error).message);
    }
    await sleep(POLL_MS);
  }
}

/** yt-dlp muss aktuell sein, da YouTube häufig Änderungen vornimmt. */
async function updateYtDlp() {
  if (!AUTO_UPDATE) return;
  try {
    await run('pip', ['install', '--quiet', '--upgrade', 'yt-dlp[default]']);
    const version = await run(YTDLP, ['--version']);
    log('yt-dlp Version', version.trim());
  } catch (err) {
    log('yt-dlp-Update fehlgeschlagen:', (err as Error).message.split('\n')[0]);
  }
}

async function main() {
  if (WORKER_TOKEN.length < 16) throw new Error('WORKER_TOKEN fehlt oder ist zu kurz (mind. 16 Zeichen)');
  log(`Worker ${WORKER_ID} startet – Server ${SERVER_URL}, ${CONCURRENCY} parallele Aufträge`);
  await updateYtDlp();
  setInterval(() => {
    if (activeJobs.size === 0) void updateYtDlp();
  }, 24 * 3600_000);
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => slot(i + 1)));
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal} empfangen – beende Worker`);
  killAll();
  await Promise.all([...activeJobs].map((id) => api(`/jobs/${id}/fail`, { error: 'Worker wurde neu gestartet', retryable: true }).catch(() => {})));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
