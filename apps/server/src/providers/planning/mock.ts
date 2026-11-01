import { HttpError } from '../../lib/http.js';
import { computeItemTimes } from './pco.js';
import type { PlanningClient, PlanningEventDetail, PlanningEventSummary, PlanningProvider } from './types.js';

/**
 * Demo-Planungstool für die lokale Entwicklung (ENABLE_MOCK_PLANNING=true).
 * Liefert eine Fake-Gemeinde mit wöchentlichen Gottesdiensten.
 */
export const MOCK_PEOPLE = [
  { externalId: 'p1', name: 'Anna Admin', email: 'anna@example.org' },
  { externalId: 'p2', name: 'Ben Techniker', email: 'ben@example.org' },
  { externalId: 'p3', name: 'Clara Musik', email: 'clara@example.org' },
  { externalId: 'p4', name: 'David Pastor', email: 'david@example.org' },
];

const SERIES = ['Hoffnung', 'Psalmen', 'Gleichnisse Jesu'];
const SPEAKERS = ['David Pastor', 'Eva Gastpredigerin'];

function sundays(): { planId: string; date: Date }[] {
  const now = new Date();
  const lastSunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay(), 9, 30));
  return Array.from({ length: 20 }, (_, i) => {
    const date = new Date(lastSunday.getTime() + (i - 12) * 7 * 86400_000);
    return { planId: `plan-${date.toISOString().slice(0, 10)}`, date };
  });
}

function buildEvent(planId: string, date: Date): PlanningEventDetail {
  const week = Math.floor(date.getTime() / (7 * 86400_000));
  const series = SERIES[week % SERIES.length];
  const speaker = SPEAKERS[week % SPEAKERS.length];
  const title = `${series} – Teil ${(week % 5) + 1}`;
  const id = `st1:${planId}`;
  const items = computeItemTimes(
    [
      { title: 'Livestream Start', lengthSec: 300, position: 'pre' },
      { title: 'Begrüssung', lengthSec: 300, position: 'during' },
      { title: 'Lobpreis', lengthSec: 1200, position: 'during' },
      { title: 'Predigt', description: `Predigt zur Serie "${series}"`, lengthSec: 2400, position: 'during' },
      { title: 'Segen', lengthSec: 120, position: 'during' },
    ],
    date.toISOString(),
  );
  return {
    id,
    title,
    subtitle: series,
    sourceName: 'Gottesdienst',
    startsAt: date.toISOString(),
    items,
    variables: {
      event: { id, title, planTitle: title, seriesTitle: series, serviceType: 'Gottesdienst', date: date.toISOString() },
      plan: { title, series_title: series },
      series: { title: series, artwork: 'https://picsum.photos/seed/' + encodeURIComponent(series) + '/1400/1400' },
      serviceType: { name: 'Gottesdienst' },
      times: { service: date.toISOString(), services: [date.toISOString()], rehearsal: '' },
      people: { Pastor: [speaker], Moderation: ['Anna Admin'], Technik: ['Ben Techniker'], 'Worship Leader': ['Clara Musik'] },
      teams: { Predigt: [speaker], Technik: ['Ben Techniker'], Band: ['Clara Musik'] },
      items: Object.fromEntries(items.map((it) => [it.title, { title: it.title, description: it.description ?? '', startsAt: it.startsAt }])),
      notes: { Allgemein: 'Abendmahl' },
    },
  };
}

class MockClient implements PlanningClient {
  constructor(private personId: string) {}

  async getIdentity() {
    const person = MOCK_PEOPLE.find((p) => p.externalId === this.personId) ?? MOCK_PEOPLE[0];
    return { org: { externalId: 'demo-org', name: 'Demo-Gemeinde', timeZone: 'Europe/Zurich' }, person };
  }

  async listEventSources() {
    return [{ id: 'st1', name: 'Gottesdienst' }];
  }

  async listEvents({ from, to, order = 'asc', limit = 100 }: Parameters<PlanningClient['listEvents']>[0]) {
    const list: PlanningEventSummary[] = sundays()
      .filter(({ date }) => (!from || date >= from) && (!to || date <= to))
      .map(({ planId, date }) => {
        const { items: _items, variables: _vars, ...summary } = buildEvent(planId, date);
        return summary;
      });
    if (order === 'desc') list.reverse();
    return list.slice(0, limit);
  }

  async getEvent(id: string) {
    const planId = id.split(':')[1] ?? '';
    const date = new Date(`${planId.replace('plan-', '')}T09:30:00Z`);
    if (isNaN(date.getTime())) throw new HttpError(404, 'Plan nicht gefunden');
    return buildEvent(planId, date);
  }

  async searchPeople(query: string) {
    const q = query.toLowerCase();
    return MOCK_PEOPLE.filter((p) => p.name.toLowerCase().includes(q) || p.email.includes(q));
  }
}

export const mockProvider: PlanningProvider = {
  key: 'mock',
  label: 'Demo (lokal)',
  requiresApp: false,
  getAuthorizeUrl: (state) => `/auth/mock/choose?state=${encodeURIComponent(state)}`,
  exchangeCode: async (code) => ({ accessToken: `mock:${code}`, expiresAt: Date.now() + 365 * 86400_000 }),
  refresh: async (tokens) => tokens,
  createClient: (tokens) => new MockClient(tokens.accessToken.replace('mock:', '')),
};
