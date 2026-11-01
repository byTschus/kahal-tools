import type { Job } from '@prisma/client';
import { prisma } from '../db.js';
import { wakeWorkerServer } from './workerServer.js';

/**
 * Einfache, datenbankbasierte Warteschlange.
 * Worker holen Aufträge per HTTP ab (claim) – beliebig viele Worker können parallel laufen,
 * jeder Auftrag wird dank atomarem Update genau einem Worker zugeteilt.
 */

export interface JobHandler {
  /** Baut die Auftragsdaten für den Worker (inkl. entschlüsselter Zugangsdaten) */
  buildPayload(job: Job): Promise<Record<string, unknown>>;
  onProgress?(job: Job, progress: number, message?: string): Promise<void>;
  onComplete(job: Job, result: any): Promise<void>;
  onFailed(job: Job, error: string, final: boolean): Promise<void>;
}

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

const LOCK_TIMEOUT_MS = 10 * 60_000;

export async function enqueueJob(tenantId: string, type: string, refId?: string) {
  const job = await prisma.job.create({ data: { tenantId, type, refId } });
  void wakeWorkerServer(tenantId);
  return job;
}

export async function claimJob(workerId: string, types: string[]) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await prisma.job.findFirst({
      where: { status: 'queued', runAfter: { lte: new Date() }, type: { in: types } },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return null;
    const { count } = await prisma.job.updateMany({
      where: { id: candidate.id, status: 'queued' },
      data: { status: 'processing', lockedBy: workerId, lockedAt: new Date(), attempts: { increment: 1 }, progress: 0 },
    });
    if (count === 0) continue; // anderer Worker war schneller
    const job = await prisma.job.findUniqueOrThrow({ where: { id: candidate.id } });
    const handler = handlers.get(job.type);
    if (!handler) {
      await failJob(job, `Kein Handler für Typ ${job.type}`, false);
      continue;
    }
    try {
      const payload = await handler.buildPayload(job);
      await handler.onProgress?.(job, 0, 'Wird verarbeitet');
      return { id: job.id, type: job.type, attempt: job.attempts, payload };
    } catch (err) {
      await failJob(job, err instanceof Error ? err.message : String(err), false);
    }
  }
  return null;
}

async function ownedJob(id: string, workerId: string) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.status !== 'processing' || job.lockedBy !== workerId) return null;
  return job;
}

export async function reportProgress(id: string, workerId: string, progress: number, message?: string) {
  const job = await ownedJob(id, workerId);
  if (!job) return false;
  await prisma.job.update({ where: { id }, data: { progress, message, lockedAt: new Date() } });
  await handlers.get(job.type)?.onProgress?.(job, progress, message);
  return true;
}

export async function completeJob(id: string, workerId: string, result: unknown) {
  const job = await ownedJob(id, workerId);
  if (!job) return false;
  await handlers.get(job.type)?.onComplete(job, result);
  await prisma.job.update({ where: { id }, data: { status: 'done', progress: 100, finishedAt: new Date(), error: null } });
  return true;
}

export async function failJob(job: Job, error: string, retryable = true) {
  const final = !retryable || job.attempts >= job.maxAttempts;
  await prisma.job.update({
    where: { id: job.id },
    data: final
      ? { status: 'failed', error, finishedAt: new Date(), lockedBy: null }
      : { status: 'queued', error, lockedBy: null, lockedAt: null, runAfter: new Date(Date.now() + 2 ** job.attempts * 60_000) },
  });
  await handlers.get(job.type)?.onFailed(job, error, final);
}

export async function failJobByWorker(id: string, workerId: string, error: string, retryable: boolean) {
  const job = await ownedJob(id, workerId);
  if (!job) return false;
  await failJob(job, error, retryable);
  return true;
}

/** Aufträge, deren Worker nicht mehr antwortet, wieder freigeben. */
export async function recoverStaleJobs() {
  const stale = await prisma.job.findMany({
    where: { status: 'processing', lockedAt: { lt: new Date(Date.now() - LOCK_TIMEOUT_MS) } },
  });
  for (const job of stale) await failJob(job, 'Worker antwortet nicht mehr (Timeout)');
  return stale.length;
}

export async function queueStats() {
  const rows = await prisma.job.groupBy({ by: ['status'], _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count]));
}
