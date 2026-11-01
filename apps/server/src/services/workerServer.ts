import { config } from '../config.js';
import { prisma } from '../db.js';
import { getServer, startServer, stopServer, type OpenStackCreds } from '../providers/cloud/openstack.js';

/**
 * Worker-Server nach Bedarf: Liegen Podcast-Aufträge an, wird der Cloud-Server gestartet,
 * nach einer Leerlaufzeit ohne Aufträge wieder heruntergefahren (spart Kosten).
 * Ein gemeinsamer Server für alle Gemeinden, konfiguriert in der .env (OPENSTACK_*, WORKER_SERVER_*).
 */

const cfg = config.workerServer;
const creds: OpenStackCreds = { authUrl: cfg.authUrl, region: cfg.region, appCredId: cfg.appCredId, appCredSecret: cfg.appCredSecret };

export const workerServerEnabled = () => Boolean(cfg.appCredId && cfg.appCredSecret && cfg.serverId);

/** Zustand nur im Speicher; nach einem Neustart zählt der Startzeitpunkt des Prozesses als letzte Aktivität. */
const state: { lastStartAt: Date; lastStopAt: Date | null; lastError: string | null; lastErrorAt: Date | null } = {
  lastStartAt: new Date(),
  lastStopAt: null,
  lastError: null,
  lastErrorAt: null,
};

let busy = false;

async function manage() {
  const now = Date.now();
  const [pending, lastJob] = await Promise.all([
    // Feed-Uploads sind kein Grund, den Server zu starten – sie laufen mit, wenn er ohnehin läuft
    prisma.job.count({ where: { status: { in: ['queued', 'processing'] }, type: { not: 'podcast.feed' }, runAfter: { lte: new Date(now + 5 * 60_000) } } }),
    prisma.job.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);

  if (pending > 0) {
    if (cfg.autoStart && (await startServer(creds, cfg.serverId))) {
      console.log(`[worker-server] wird gestartet (${pending} Auftrag/Aufträge)`);
      state.lastStartAt = new Date();
    }
    return;
  }

  if (!cfg.autoStop) return;
  const lastActivity = Math.max(lastJob?.updatedAt.getTime() ?? 0, state.lastStartAt.getTime());
  if (now - lastActivity < cfg.idleMinutes * 60_000) return;
  if (await stopServer(creds, cfg.serverId)) {
    console.log('[worker-server] wird heruntergefahren (keine Aufträge)');
    state.lastStopAt = new Date();
  }
}

/** Vom Scheduler und direkt nach dem Einreihen eines Auftrags aufgerufen */
export async function manageWorkerServer() {
  if (!workerServerEnabled() || busy) return;
  busy = true;
  try {
    await manage();
    state.lastError = null;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    state.lastErrorAt = new Date();
    console.warn('[worker-server]', state.lastError);
  } finally {
    busy = false;
  }
}

export async function workerServerStatus() {
  if (!workerServerEnabled()) return { enabled: false as const };
  let server = null;
  let error: string | null = null;
  try {
    server = await getServer(creds, cfg.serverId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { enabled: true as const, server, error, autoStart: cfg.autoStart, autoStop: cfg.autoStop, idleMinutes: cfg.idleMinutes, state };
}

/** Manuell starten; zählt als Aktivität, der Server bleibt mindestens die Leerlaufzeit lang an */
export async function startWorkerServer() {
  const changed = await startServer(creds, cfg.serverId);
  state.lastStartAt = new Date();
  return changed;
}

/** Manuell stoppen – nicht, solange ein Auftrag verarbeitet wird (auch nicht von einer anderen Gemeinde) */
export async function stopWorkerServer() {
  const processing = await prisma.job.count({ where: { status: 'processing' } });
  if (processing > 0) return { changed: false, reason: 'Es wird gerade ein Podcast verarbeitet.' };
  const changed = await stopServer(creds, cfg.serverId);
  if (changed) state.lastStopAt = new Date();
  return { changed };
}
