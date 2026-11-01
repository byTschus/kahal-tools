import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';

/** Jeder Plan kann pro Tool nur einem Eintrag zugeordnet sein. */
export type PlanTool = 'livestream' | 'podcast' | 'visitors';

const TOOL_LABEL: Record<PlanTool, string> = { livestream: 'Livestream', podcast: 'Podcast', visitors: 'Besucher-Erfassung' };

/** Zuordnungen (planId -> Eintrag) für die angegebenen Pläne */
export async function linkedEntries(tool: PlanTool, tenantId: string, planIds: string[]) {
  const where = { tenantId, planId: { in: planIds } };
  const rows =
    tool === 'livestream'
      ? (await prisma.livestream.findMany({ where, select: { id: true, planId: true, title: true } })).map((r) => ({ ...r, id: r.id }))
      : tool === 'podcast'
        ? await prisma.podcast.findMany({ where, select: { id: true, planId: true, title: true } })
        : (await prisma.visitorCount.findMany({ where, select: { id: true, planId: true, eventTitle: true } })).map((r) => ({ id: r.id, planId: r.planId, title: r.eventTitle }));
  return new Map(rows.map((r) => [r.planId!, { id: r.id, title: r.title }]));
}

/** Wirft 409, wenn der Plan schon einem anderen Eintrag desselben Tools gehört */
export async function assertPlanFree(tool: PlanTool, tenantId: string, planId: string | null | undefined, ownId?: string | null) {
  if (!planId) return;
  const existing = (await linkedEntries(tool, tenantId, [planId])).get(planId);
  if (existing && existing.id !== ownId) {
    throw new HttpError(409, `Dieser Plan ist bereits dem ${TOOL_LABEL[tool]} „${existing.title}“ zugeordnet`);
  }
}
