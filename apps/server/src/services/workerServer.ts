import type { Integration } from '@prisma/client';
import { prisma } from '../db.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { getServer, startServer, stopServer, type OpenStackCreds } from '../providers/cloud/openstack.js';

/**
 * Worker-Server nach Bedarf: Liegen Podcast-Aufträge an, wird der Cloud-Server gestartet,
 * nach einer Leerlaufzeit ohne Aufträge wieder heruntergefahren (spart Kosten).
 * Pro Gemeinde ein Server, gespeichert als Integration "workerServer".
 */

export interface WorkerServerConfig {
  authUrl: string;
  region: string | null;
  appCredId: string;
  serverId: string;
  serverName: string | null;
  autoStart: boolean;
  autoStop: boolean;
  idleMinutes: number;
  state?: {
    lastStartAt?: string | null;
    lastStopAt?: string | null;
    lastError?: string | null;
    lastErrorAt?: string | null;
  };
}

export const WORKER_SERVER_KIND = 'workerServer';

export function getWorkerServer(tenantId: string) {
  return prisma.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: WORKER_SERVER_KIND } } });
}

export function credsOf(integration: Integration): { cfg: WorkerServerConfig; creds: OpenStackCreds } {
  const cfg = integration.config as unknown as WorkerServerConfig;
  const secret = decryptJson<{ appCredSecret: string }>(integration.secrets)?.appCredSecret ?? '';
  return { cfg, creds: { authUrl: cfg.authUrl, region: cfg.region, appCredId: cfg.appCredId, appCredSecret: secret } };
}

export async function saveState(integration: Integration, patch: NonNullable<WorkerServerConfig['state']>) {
  const cfg = integration.config as unknown as WorkerServerConfig;
  await prisma.integration.update({
    where: { id: integration.id },
    data: { config: { ...cfg, state: { ...cfg.state, ...patch } } as any },
  });
}

export function encryptWorkerSecret(appCredSecret: string) {
  return encryptJson({ appCredSecret });
}

const busy = new Set<string>();

async function manage(integration: Integration) {
  const { cfg, creds } = credsOf(integration);
  const tenantId = integration.tenantId;
  const now = Date.now();

  const [pending, lastJob] = await Promise.all([
    prisma.job.count({ where: { tenantId, status: { in: ['queued', 'processing'] }, runAfter: { lte: new Date(now + 5 * 60_000) } } }),
    prisma.job.findFirst({ where: { tenantId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);

  if (pending > 0) {
    if (cfg.autoStart && (await startServer(creds, cfg.serverId))) {
      console.log(`[worker-server] ${cfg.serverName ?? cfg.serverId} wird gestartet (${pending} Auftrag/Aufträge)`);
      await saveState(integration, { lastStartAt: new Date().toISOString(), lastError: null });
    } else if (cfg.state?.lastError) {
      await saveState(integration, { lastError: null });
    }
    return;
  }

  if (!cfg.autoStop) return;
  const lastActivity = Math.max(lastJob?.updatedAt.getTime() ?? 0, Date.parse(cfg.state?.lastStartAt ?? '') || 0);
  if (now - lastActivity < Math.max(5, cfg.idleMinutes) * 60_000) return;
  if (await stopServer(creds, cfg.serverId)) {
    console.log(`[worker-server] ${cfg.serverName ?? cfg.serverId} wird heruntergefahren (keine Aufträge)`);
    await saveState(integration, { lastStopAt: new Date().toISOString(), lastError: null });
  }
}

async function manageSafe(integration: Integration) {
  if (busy.has(integration.tenantId)) return;
  busy.add(integration.tenantId);
  try {
    await manage(integration);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[worker-server] ${integration.tenantId}:`, message);
    await saveState(integration, { lastError: message, lastErrorAt: new Date().toISOString() }).catch(() => {});
  } finally {
    busy.delete(integration.tenantId);
  }
}

/** Vom Scheduler aufgerufen: alle Worker-Server prüfen */
export async function manageWorkerServers() {
  const list = await prisma.integration.findMany({ where: { kind: WORKER_SERVER_KIND } });
  for (const integration of list) await manageSafe(integration);
}

/** Direkt nach dem Einreihen eines Auftrags: Server sofort starten statt auf den Scheduler zu warten */
export async function wakeWorkerServer(tenantId: string) {
  const integration = await getWorkerServer(tenantId);
  if (integration) await manageSafe(integration);
}

export async function liveStatus(integration: Integration) {
  const { cfg, creds } = credsOf(integration);
  return getServer(creds, cfg.serverId);
}
