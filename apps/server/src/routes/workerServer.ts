import { Router } from 'express';
import { z } from 'zod';
import { requirePerm, tid } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';
import { DEFAULT_AUTH_URL, getServer, listServers, startServer, stopServer, type OpenStackCreds } from '../providers/cloud/openstack.js';
import { credsOf, encryptWorkerSecret, getWorkerServer, liveStatus, saveState, WORKER_SERVER_KIND, type WorkerServerConfig } from '../services/workerServer.js';

/** Einstellungen → Podcast → Worker-Server (OpenStack, z.B. Infomaniak Public Cloud) */
export const workerServerRouter = Router();
const perm = requirePerm('podcast', 'settings');

const credsSchema = z.object({
  authUrl: z.string().trim().url('Ungültige Auth-URL').default(DEFAULT_AUTH_URL),
  region: z.string().trim().optional().nullable(),
  appCredId: z.string().trim().min(8, 'Application Credential ID fehlt'),
  appCredSecret: z.string().optional(),
});

/** Formularwerte zu Zugangsdaten; leeres Secret = gespeichertes Secret verwenden */
async function credsFrom(tenantId: string, input: z.infer<typeof credsSchema>): Promise<OpenStackCreds> {
  let secret = input.appCredSecret;
  if (!secret) {
    const existing = await getWorkerServer(tenantId);
    if (existing && credsOf(existing).cfg.appCredId === input.appCredId) secret = credsOf(existing).creds.appCredSecret;
  }
  if (!secret) throw new HttpError(400, 'Application Credential Secret fehlt');
  return { authUrl: input.authUrl, region: input.region || null, appCredId: input.appCredId, appCredSecret: secret };
}

workerServerRouter.get('/api/worker-server', perm, async (req, res) => {
  const integration = await getWorkerServer(tid(req));
  if (!integration) {
    res.json({ configured: false, defaults: { authUrl: DEFAULT_AUTH_URL } });
    return;
  }
  const { cfg } = credsOf(integration);
  let server = null;
  let error: string | null = null;
  try {
    server = await liveStatus(integration);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  res.json({ configured: true, config: cfg, server, error, defaults: { authUrl: DEFAULT_AUTH_URL } });
});

/** Zugangsdaten prüfen und Server zur Auswahl auflisten */
workerServerRouter.post('/api/worker-server/servers', perm, async (req, res) => {
  const creds = await credsFrom(tid(req), credsSchema.parse(req.body));
  res.json(await listServers(creds));
});

const saveSchema = credsSchema.extend({
  serverId: z.string().trim().min(1, 'Bitte einen Server auswählen'),
  autoStart: z.boolean().default(true),
  autoStop: z.boolean().default(true),
  idleMinutes: z.number().int().min(5).max(24 * 60).default(15),
});

workerServerRouter.put('/api/worker-server', perm, async (req, res) => {
  const tenantId = tid(req);
  const body = saveSchema.parse(req.body);
  const creds = await credsFrom(tenantId, body);
  const server = await getServer(creds, body.serverId);
  const existing = await getWorkerServer(tenantId);
  const config: WorkerServerConfig = {
    authUrl: creds.authUrl,
    region: creds.region ?? null,
    appCredId: creds.appCredId,
    serverId: server.id,
    serverName: server.name,
    autoStart: body.autoStart,
    autoStop: body.autoStop,
    idleMinutes: body.idleMinutes,
    state: existing ? credsOf(existing).cfg.state : {},
  };
  const data = { provider: 'openstack', label: server.name, config: config as any, secrets: encryptWorkerSecret(creds.appCredSecret) };
  await prisma.integration.upsert({
    where: { tenantId_kind: { tenantId, kind: WORKER_SERVER_KIND } },
    create: { tenantId, kind: WORKER_SERVER_KIND, ...data },
    update: data,
  });
  res.json({ ok: true });
});

async function requireWorkerServer(tenantId: string) {
  const integration = await getWorkerServer(tenantId);
  if (!integration) throw new HttpError(400, 'Kein Worker-Server eingerichtet');
  return { integration, ...credsOf(integration) };
}

workerServerRouter.post('/api/worker-server/start', perm, async (req, res) => {
  const { integration, cfg, creds } = await requireWorkerServer(tid(req));
  const changed = await startServer(creds, cfg.serverId);
  // Zählt als Aktivität: der Server bleibt mindestens die Leerlaufzeit lang an
  await saveState(integration, { lastStartAt: new Date().toISOString(), lastError: null });
  res.json({ ok: true, changed });
});

workerServerRouter.post('/api/worker-server/stop', perm, async (req, res) => {
  const { integration, cfg, creds } = await requireWorkerServer(tid(req));
  const changed = await stopServer(creds, cfg.serverId);
  if (changed) await saveState(integration, { lastStopAt: new Date().toISOString() });
  res.json({ ok: true, changed });
});

workerServerRouter.delete('/api/worker-server', perm, async (req, res) => {
  await prisma.integration.deleteMany({ where: { tenantId: tid(req), kind: WORKER_SERVER_KIND } });
  res.json({ ok: true });
});
