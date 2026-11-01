import { Router, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { claimJob, completeJob, failJobByWorker, queueStats, reportProgress } from '../services/jobs.js';

/** API für die Worker (Podcast-Verarbeitung auf dem Public-Cloud-Server). Authentifizierung per WORKER_TOKEN. */
export const workerRouter = Router();

function requireWorker(req: Request, _res: Response, next: NextFunction) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const expected = config.workerToken;
  const ok = expected.length >= 16 && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!ok) throw new HttpError(401, 'Ungültiges Worker-Token');
  next();
}

workerRouter.use('/api/worker', requireWorker);

const workerId = (req: Request) => String(req.headers['x-worker-id'] ?? 'worker').slice(0, 100);

workerRouter.get('/api/worker/ping', async (_req, res) => {
  res.json({ ok: true, queue: await queueStats() });
});

workerRouter.post('/api/worker/claim', async (req, res) => {
  const types = z.object({ types: z.array(z.string()).default(['podcast.render']) }).parse(req.body ?? {}).types;
  const job = await claimJob(workerId(req), types);
  if (!job) {
    res.status(204).end();
    return;
  }
  res.json(job);
});

workerRouter.post('/api/worker/jobs/:id/progress', async (req, res) => {
  const body = z.object({ progress: z.number().min(0).max(100), message: z.string().optional() }).parse(req.body);
  const ok = await reportProgress(String(req.params.id), workerId(req), Math.round(body.progress), body.message);
  res.status(ok ? 200 : 409).json({ ok });
});

workerRouter.post('/api/worker/jobs/:id/complete', async (req, res) => {
  const ok = await completeJob(String(req.params.id), workerId(req), req.body?.result ?? {});
  res.status(ok ? 200 : 409).json({ ok });
});

workerRouter.post('/api/worker/jobs/:id/fail', async (req, res) => {
  const body = z.object({ error: z.string(), retryable: z.boolean().default(true) }).parse(req.body);
  const ok = await failJobByWorker(String(req.params.id), workerId(req), body.error.slice(0, 5000), body.retryable);
  res.status(ok ? 200 : 409).json({ ok });
});

