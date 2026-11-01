import type { User } from '@prisma/client';
import { formatDate } from '../lib/template.js';
import type { PlanningEventSummary } from '../providers/planning/types.js';
import { getSettings } from '../settings.js';
import { linkedEntries, type PlanTool } from './planLinks.js';
import { planningClientFor } from './planning.js';

/**
 * Automatische Zuordnung importierter Einträge zu Plänen.
 * Entscheidend ist das Datum (Tag in der Zeitzone der Gemeinde, ggf. die Uhrzeit), der Titel hilft bei
 * mehreren Plänen am selben Tag oder wenn das Datum etwas abweicht (z.B. Podcast erst am Montag veröffentlicht).
 * Jeder Plan wird höchstens einmal vergeben; bereits verknüpfte Pläne bleiben unangetastet.
 * Nicht eindeutige Fälle werden nicht zugeordnet.
 */

export interface MatchEntry {
  key: string;
  date: Date;
  /** false = Uhrzeit unbekannt, nur der Tag zählt */
  hasTime: boolean;
  title: string;
}

export interface PlanMatch {
  planId: string;
  title: string;
  startsAt: string | null;
}

export interface MatchResult {
  matches: Map<string, PlanMatch>;
  /** Einträge mit mehreren gleich guten Plänen */
  ambiguous: Set<string>;
  error?: string;
}

/** Erlaubter Abstand Plan-Tag minus Eintrag-Tag; mit ähnlichem Titel darf er grösser sein */
const WINDOW: Record<PlanTool, { near: [number, number]; withTitle: [number, number] }> = {
  visitors: { near: [0, 0], withTitle: [-1, 1] },
  livestream: { near: [0, 0], withTitle: [-1, 1] },
  // Podcasts werden oft erst ein paar Tage nach dem Gottesdienst veröffentlicht
  podcast: { near: [-2, 1], withTitle: [-7, 1] },
};
const TITLE_HINT = 0.35;
const AMBIGUITY = 5;
const DAY = 86400_000;

const STOPWORDS = new Set(['der', 'die', 'das', 'und', 'mit', 'im', 'in', 'am', 'an', 'zu', 'zum', 'zur', 'von', 'vom', 'ein', 'eine', 'des', 'den', 'dem', 'teil', 'the', 'and', 'of']);

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s: string) {
  const out = new Map<string, number>();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
  return out;
}

/** Ähnlichkeit zweier Titel (0..1): Wörter oder Buchstabenpaare, je nachdem was besser passt */
export function titleSimilarity(a: string, b: string) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const words = (s: string) => new Set(s.split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w)));
  const wa = words(na);
  const wb = words(nb);
  const common = [...wa].filter((w) => wb.has(w)).length;
  const wordScore = wa.size && wb.size ? (2 * common) / (wa.size + wb.size) : 0;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let shared = 0;
  for (const [g, n] of ba) shared += Math.min(n, bb.get(g) ?? 0);
  const total = [...ba.values()].reduce((s, n) => s + n, 0) + [...bb.values()].reduce((s, n) => s + n, 0);
  const charScore = total ? (2 * shared) / total : 0;
  return Math.max(wordScore, charScore);
}

const dayIndex = (d: Date, timeZone: string) => Math.round(Date.parse(formatDate(d, 'yyyy-MM-dd', timeZone)) / DAY);

function score(tool: PlanTool, entry: MatchEntry, plan: PlanningEventSummary, timeZone: string) {
  if (!plan.startsAt) return null;
  const start = new Date(plan.startsAt);
  const dayDiff = dayIndex(start, timeZone) - dayIndex(entry.date, timeZone);
  const sim = titleSimilarity(entry.title, plan.title);
  const w = WINDOW[tool];
  const inNear = dayDiff >= w.near[0] && dayDiff <= w.near[1];
  const inTitle = sim >= TITLE_HINT && dayDiff >= w.withTitle[0] && dayDiff <= w.withTitle[1];
  if (!inNear && !inTitle) return null;
  let s = 100 - 15 * Math.abs(dayDiff) + 60 * sim;
  if (entry.hasTime && dayDiff === 0) s -= Math.min(40, Math.abs(start.getTime() - entry.date.getTime()) / 60_000 / 5);
  return s;
}

export async function matchPlans(
  user: User & { tenant: { planningProvider: string; timeZone: string } },
  tool: PlanTool,
  entries: MatchEntry[],
): Promise<MatchResult> {
  const result: MatchResult = { matches: new Map(), ambiguous: new Set() };
  const valid = entries.filter((e) => !isNaN(e.date.getTime()));
  if (!valid.length) return result;
  const timeZone = user.tenant.timeZone;

  let plans: PlanningEventSummary[];
  try {
    const times = valid.map((e) => e.date.getTime());
    const client = await planningClientFor(user);
    const { sourceIds } = await getSettings(user.tenantId, 'planning');
    plans = await client.listEvents({
      from: new Date(Math.min(...times) - 8 * DAY),
      to: new Date(Math.max(...times) + 2 * DAY),
      sourceIds,
      order: 'asc',
      limit: 3000,
    });
  } catch (err) {
    result.error = `Pläne konnten nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  const taken = await linkedEntries(tool, user.tenantId, plans.map((p) => p.id));
  plans = plans.filter((p) => !taken.has(p.id));

  // Alle möglichen Paare bewerten
  const candidates = new Map<string, { plan: PlanningEventSummary; score: number }[]>();
  const pairs: { entry: string; plan: PlanningEventSummary; score: number }[] = [];
  for (const entry of valid) {
    const list = plans
      .map((plan) => ({ plan, score: score(tool, entry, plan, timeZone) }))
      .filter((c): c is { plan: PlanningEventSummary; score: number } => c.score !== null)
      .sort((a, b) => b.score - a.score);
    candidates.set(entry.key, list);
    pairs.push(...list.map((c) => ({ entry: entry.key, ...c })));
  }

  // Gleich gute Alternativen = nicht eindeutig
  for (const [key, list] of candidates) {
    if (list.length > 1 && list[0].score - list[1].score < AMBIGUITY) result.ambiguous.add(key);
  }
  // Beste Paare zuerst vergeben, jeder Plan nur einmal
  pairs.sort((a, b) => b.score - a.score);
  const usedPlans = new Set<string>();
  const open = (key: string) => !result.ambiguous.has(key) && !result.matches.has(key);
  for (const p of pairs) {
    if (!open(p.entry) || usedPlans.has(p.plan.id)) continue;
    // Bewirbt sich ein anderer offener Eintrag gleich stark um denselben Plan, ist es nicht eindeutig
    const rivals = pairs.filter((o) => o.plan.id === p.plan.id && o.entry !== p.entry && open(o.entry) && p.score - o.score < AMBIGUITY);
    if (rivals.length) {
      for (const key of [p.entry, ...rivals.map((o) => o.entry)]) result.ambiguous.add(key);
      continue;
    }
    usedPlans.add(p.plan.id);
    result.matches.set(p.entry, { planId: p.plan.id, title: p.plan.title, startsAt: p.plan.startsAt });
  }
  return result;
}
