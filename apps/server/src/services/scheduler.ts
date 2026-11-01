import { prisma } from '../db.js';
import { streamingFor } from './integrations.js';
import { recoverStaleJobs } from './jobs.js';
import { manageWorkerServers } from './workerServer.js';

/**
 * Hintergrundaufgaben im Server-Prozess:
 * - Hängende Worker-Aufträge wieder freigeben
 * - Worker-Server in der Cloud nach Bedarf starten und stoppen
 * - Während laufender Livestreams die Zuschauerzahlen abfragen (Spitzenwert der gleichzeitigen Zuschauer
 *   ist bei YouTube nur während des Streams abrufbar und wird deshalb hier mitgeschrieben)
 */
const POLL_INTERVAL_MS = 2 * 60_000;

export function startScheduler() {
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[scheduler] ${name}:`, err instanceof Error ? err.message : err);
    }
  };
  const tick = () => {
    void run('jobs', recoverStaleJobs).then(() => run('worker-server', manageWorkerServers));
    void run('livestreams', pollLivestreams);
  };
  setTimeout(tick, 10_000);
  setInterval(tick, POLL_INTERVAL_MS);
}

export async function pollLivestreams() {
  const now = Date.now();
  const streams = await prisma.livestream.findMany({
    where: {
      scheduledStart: { gte: new Date(now - 8 * 3600_000), lte: new Date(now + 30 * 60_000) },
      OR: [{ status: null }, { status: { not: 'completed' } }],
    },
  });
  const byTenant = new Map<string, typeof streams>();
  for (const s of streams) byTenant.set(s.tenantId, [...(byTenant.get(s.tenantId) ?? []), s]);

  for (const [tenantId, list] of byTenant) {
    const streaming = await streamingFor(tenantId);
    if (!streaming) continue;
    const stats = await streaming.client.getStats(list.map((s) => s.externalId));
    for (const s of list) {
      const st = stats[s.externalId];
      if (!st) continue;
      await prisma.livestream.update({
        where: { id: s.id },
        data: {
          status: st.status ?? s.status,
          peakConcurrent: Math.max(s.peakConcurrent ?? 0, st.concurrentViewers ?? 0) || s.peakConcurrent,
          viewCount: st.viewCount ?? s.viewCount,
          lastPolledAt: new Date(),
        },
      });
    }
  }
}
