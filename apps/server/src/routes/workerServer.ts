import { Router } from 'express';
import { requirePerm } from '../auth/middleware.js';
import { HttpError } from '../lib/http.js';
import { startWorkerServer, stopWorkerServer, workerServerEnabled, workerServerStatus } from '../services/workerServer.js';

/** Status des gemeinsamen Worker-Servers (Konfiguration in der .env) */
export const workerServerRouter = Router();
const perm = requirePerm('podcast', 'settings');

function requireEnabled() {
  if (!workerServerEnabled()) throw new HttpError(400, 'Kein Worker-Server konfiguriert');
}

workerServerRouter.get('/api/worker-server', perm, async (_req, res) => {
  res.json(await workerServerStatus());
});

workerServerRouter.post('/api/worker-server/start', perm, async (_req, res) => {
  requireEnabled();
  res.json({ changed: await startWorkerServer() });
});

workerServerRouter.post('/api/worker-server/stop', perm, async (_req, res) => {
  requireEnabled();
  res.json(await stopWorkerServer());
});
