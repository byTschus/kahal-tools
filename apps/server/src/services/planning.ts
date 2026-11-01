import type { User } from '@prisma/client';
import { prisma } from '../db.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';
import { getPlanningProvider, type PlanningClient, type PlanningEventDetail, type PlanningTokens } from '../providers/planning/index.js';

/**
 * Liefert einen API-Client für das Planungstool im Namen des Benutzers.
 * Tokens werden bei Bedarf automatisch erneuert und gespeichert.
 */
export async function planningClientFor(user: User & { tenant: { planningProvider: string } }): Promise<PlanningClient> {
  const provider = getPlanningProvider(user.tenant.planningProvider);
  let tokens = decryptJson<PlanningTokens>(user.planningAuth);
  if (!tokens) throw new HttpError(401, 'Bitte neu anmelden, um auf das Planungstool zuzugreifen', 'reauth');
  if (tokens.expiresAt && tokens.expiresAt < Date.now() + 30_000) {
    tokens = await provider.refresh(tokens);
    await prisma.user.update({ where: { id: user.id }, data: { planningAuth: encryptJson(tokens) } });
  }
  return provider.createClient(tokens);
}

export interface StartTimeSettings {
  startItemTitle: string;
  startOffsetMinutes: number;
}

/** Ermittelt die Startzeit aus dem Plan anhand des konfigurierten Items. */
export function resolveStartTime(event: PlanningEventDetail, settings: StartTimeSettings): { startsAt: string | null; source: string } {
  const needle = settings.startItemTitle.trim().toLowerCase();
  const item = needle ? event.items.find((i) => i.title.toLowerCase().includes(needle) && i.startsAt) : undefined;
  const base = item?.startsAt ?? event.startsAt;
  if (!base) return { startsAt: null, source: 'Keine Zeit im Plan gefunden' };
  const date = new Date(new Date(base).getTime() + settings.startOffsetMinutes * 60_000);
  return {
    startsAt: date.toISOString(),
    source: item ? `Item "${item.title}"` : needle ? `Gottesdienstbeginn (Item "${settings.startItemTitle}" nicht gefunden)` : 'Gottesdienstbeginn',
  };
}
