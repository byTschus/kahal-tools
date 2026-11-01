import type { Podcast, Tenant } from '@prisma/client';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getStreamingProvider } from '../providers/streaming/index.js';
import { getSettings } from '../settings.js';
import { podcastHostFor, requirePodcastHost } from './integrations.js';
import { enqueueJob, registerJobHandler } from './jobs.js';

export const PODCAST_JOB = 'podcast.render';
/** Lädt ein hochgeladenes PDF über den Worker auf das Podcast-Hosting */
export const PODCAST_PDF_JOB = 'podcast.pdf';
/** Lädt feed.xml über den Worker auf das Podcast-Hosting; startet den Worker-Server nicht */
export const PODCAST_FEED_JOB = 'podcast.feed';

/** Ablage hochgeladener PDFs, bis der Worker sie übertragen hat */
export async function pdfUploadPath(podcastId: string) {
  const dir = join(config.dataDir, 'uploads');
  await mkdir(dir, { recursive: true });
  return join(dir, `${podcastId.replace(/[^a-z0-9]/gi, '')}.pdf`);
}

/**
 * Dateiname ohne Endung: Sekunden seit 1970 (z.B. 1787908529), eindeutig pro Gemeinde.
 * MP3 und PDF einer Episode teilen sich denselben Namen.
 */
export async function nextFileBase(tenantId: string) {
  let ts = Math.floor(Date.now() / 1000);
  for (;;) {
    const taken = await prisma.podcast.count({ where: { tenantId, OR: [{ fileName: `${ts}.mp3` }, { pdfFileName: `${ts}.pdf` }] } });
    if (!taken) return String(ts);
    ts++;
  }
}

/** Basisname einer Episode (für das PDF): vom MP3 übernommen oder neu erzeugt */
export async function fileBaseOf(podcast: Podcast) {
  if (podcast.fileName) return podcast.fileName.replace(/\.mp3$/i, '');
  if (podcast.pdfFileName) return podcast.pdfFileName.replace(/\.pdf$/i, '');
  return nextFileBase(podcast.tenantId);
}

/** Link zum Video der Episode (YouTube oder Link aus dem importierten Feed) */
export function videoUrlOf(podcast: Podcast) {
  if (podcast.sourceProvider && podcast.sourceVideoId) return getStreamingProvider(podcast.sourceProvider).videoUrl(podcast.sourceVideoId);
  return podcast.linkUrl;
}

export const durationOf = (p: Podcast) => p.durationSec ?? (p.endSec != null && p.startSec != null ? p.endSec - p.startSec : 0);

registerJobHandler(PODCAST_JOB, {
  async buildPayload(job) {
    const podcast = await prisma.podcast.findUniqueOrThrow({ where: { id: job.refId! } });
    const host = await requirePodcastHost(job.tenantId);
    const settings = await getSettings(job.tenantId, 'podcast');
    if (!podcast.sourceVideoId || podcast.startSec == null || podcast.endSec == null) throw new Error('Episode hat kein Quellvideo');
    return {
      podcastId: podcast.id,
      videoUrl: videoUrlOf(podcast),
      startSec: podcast.startSec,
      endSec: podcast.endSec,
      fileName: podcast.fileName,
      audio: { bitrate: settings.bitrate, mono: settings.mono, normalize: settings.normalize },
      tags: {
        title: podcast.title,
        artist: podcast.speaker ?? '',
        album: settings.feed.title,
        date: podcast.createdAt.toISOString().slice(0, 10),
        comment: podcast.description ?? '',
      },
      imageUrl: podcast.imageUrl,
      host: { type: host.integration.provider, config: host.config, secrets: host.secrets },
    };
  },

  async onProgress(job, progress, message) {
    await prisma.podcast.updateMany({
      where: { id: job.refId! },
      data: { status: 'processing', progress, error: message && progress === 0 ? null : undefined },
    });
  },

  async onComplete(job, result: { fileSize?: number; durationSec?: number }) {
    const host = await requirePodcastHost(job.tenantId);
    const podcast = await prisma.podcast.findUniqueOrThrow({ where: { id: job.refId! } });
    await prisma.podcast.update({
      where: { id: podcast.id },
      data: {
        status: 'published',
        progress: 100,
        error: null,
        fileSize: result.fileSize ?? null,
        durationSec: result.durationSec ?? durationOf(podcast),
        audioUrl: host.provider.publicUrl(host.config, podcast.fileName!),
        publishedAt: podcast.publishedAt ?? new Date(),
      },
    });
    await syncFeed(job.tenantId);
  },

  async onFailed(job, error, final) {
    await prisma.podcast.updateMany({
      where: { id: job.refId! },
      data: final ? { status: 'failed', error } : { status: 'queued', error: `${error} – neuer Versuch folgt` },
    });
  },
});

registerJobHandler(PODCAST_PDF_JOB, {
  async buildPayload(job) {
    const podcast = await prisma.podcast.findUniqueOrThrow({ where: { id: job.refId! } });
    const host = await requirePodcastHost(job.tenantId);
    if (!podcast.pdfFileName) throw new Error('Kein PDF hinterlegt');
    return {
      podcastId: podcast.id,
      // Der Worker lädt die Datei mit seinem Token vom Server (siehe routes/worker.ts)
      filePath: `/jobs/${job.id}/file`,
      fileName: podcast.pdfFileName,
      host: { type: host.integration.provider, config: host.config, secrets: host.secrets },
    };
  },

  async onComplete(job) {
    const host = await requirePodcastHost(job.tenantId);
    const podcast = await prisma.podcast.findUniqueOrThrow({ where: { id: job.refId! } });
    await prisma.podcast.update({
      where: { id: podcast.id },
      data: { pdfStatus: 'uploaded', pdfUrl: host.provider.publicUrl(host.config, podcast.pdfFileName!) },
    });
    await rm(await pdfUploadPath(podcast.id), { force: true });
    await syncFeed(job.tenantId);
  },

  async onFailed(job, _error, final) {
    if (final) await prisma.podcast.updateMany({ where: { id: job.refId! }, data: { pdfStatus: 'failed' } });
  },
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function feedUrl(tenant: Pick<Tenant, 'slug'>) {
  return `${config.appUrl}/feeds/${tenant.slug}/podcast.xml`;
}

/** RSS-Feed (Apple/Spotify-kompatibel) aus allen veröffentlichten Episoden */
export async function buildFeed(tenant: Tenant): Promise<string> {
  const settings = await getSettings(tenant.id, 'podcast');
  const feed = settings.feed;
  const episodes: Podcast[] = await prisma.podcast.findMany({
    where: { tenantId: tenant.id, status: 'published', audioUrl: { not: null } },
    orderBy: { publishedAt: 'desc' },
    take: 500,
  });
  const title = feed.title || tenant.name;
  const items = episodes
    .map(
      (e) => `    <item>
      <title>${esc(e.title)}</title>
      <description>${esc(e.description ?? '')}</description>
      <itunes:summary>${esc(e.description ?? '')}</itunes:summary>
      ${e.speaker ? `<itunes:author>${esc(e.speaker)}</itunes:author>` : ''}
      <enclosure url="${esc(e.audioUrl ?? '')}" length="${e.fileSize ?? 0}" type="audio/mpeg"/>
      <guid isPermaLink="false">${e.id}</guid>
      <pubDate>${(e.publishedAt ?? e.createdAt).toUTCString()}</pubDate>
      <itunes:duration>${duration(durationOf(e))}</itunes:duration>
      ${e.imageUrl ? `<itunes:image href="${esc(e.imageUrl)}"/>` : ''}
      <itunes:explicit>${feed.explicit ? 'true' : 'false'}</itunes:explicit>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(feed.websiteUrl || config.appUrl)}</link>
    <atom:link href="${esc(feedUrl(tenant))}" rel="self" type="application/rss+xml"/>
    <description>${esc(feed.description || title)}</description>
    <language>${esc(feed.language)}</language>
    <itunes:author>${esc(feed.author || tenant.name)}</itunes:author>
    <itunes:owner><itunes:name>${esc(feed.author || tenant.name)}</itunes:name><itunes:email>${esc(feed.email)}</itunes:email></itunes:owner>
    ${feed.imageUrl ? `<itunes:image href="${esc(feed.imageUrl)}"/>\n    <image><url>${esc(feed.imageUrl)}</url><title>${esc(title)}</title><link>${esc(feed.websiteUrl || config.appUrl)}</link></image>` : ''}
    <itunes:category text="${esc(feed.category)}"/>
    <itunes:explicit>${feed.explicit ? 'true' : 'false'}</itunes:explicit>
${items}
  </channel>
</rss>
`;
}

/**
 * Lädt den Feed zusätzlich als feed.xml auf das Podcast-Hosting (falls aktiviert).
 * Das macht der Worker; der Auftrag startet den Worker-Server nicht, sondern wird beim nächsten Lauf
 * mit erledigt (z.B. direkt nach dem nächsten Podcast). Pro Gemeinde wartet höchstens ein Auftrag,
 * der Feed wird erst beim Abholen erzeugt und ist damit immer aktuell.
 */
export async function syncFeed(tenantId: string) {
  try {
    const settings = await getSettings(tenantId, 'podcast');
    if (!settings.uploadFeed || !(await podcastHostFor(tenantId))) return;
    const waiting = await prisma.job.count({ where: { tenantId, type: PODCAST_FEED_JOB, status: 'queued' } });
    if (!waiting) await enqueueJob(tenantId, PODCAST_FEED_JOB, tenantId);
  } catch (err) {
    console.warn('Feed-Upload konnte nicht eingeplant werden:', err instanceof Error ? err.message : err);
  }
}

registerJobHandler(PODCAST_FEED_JOB, {
  async buildPayload(job) {
    const host = await requirePodcastHost(job.tenantId);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: job.tenantId } });
    return {
      fileName: 'feed.xml',
      content: await buildFeed(tenant),
      host: { type: host.integration.provider, config: host.config, secrets: host.secrets },
    };
  },
  async onComplete() {},
  async onFailed() {},
});
