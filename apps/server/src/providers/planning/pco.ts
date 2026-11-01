import { fetchJson, HttpError } from '../../lib/http.js';
import type {
  OAuthAppCreds,
  PlanningClient,
  PlanningEventDetail,
  PlanningEventSummary,
  PlanningIdentity,
  PlanningItem,
  PlanningProvider,
  PlanningTokens,
} from './types.js';

/**
 * Planning Center Online (https://developer.planning.center/docs)
 * OAuth 2: Access-Token 2h gültig, Refresh-Token 90 Tage.
 */
const API = 'https://api.planningcenteronline.com';
const SCOPES = 'people services';

interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, any>;
  relationships?: Record<string, { data: { id: string; type: string } | { id: string; type: string }[] | null }>;
}
interface JsonApiDoc {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  links?: { next?: string };
}

function tokenResponse(body: any, app: OAuthAppCreds): PlanningTokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (Number(body.expires_in ?? 7200) - 60) * 1000,
    clientId: app.clientId,
  };
}

function requireApp(app: OAuthAppCreds | null): OAuthAppCreds {
  if (!app) throw new HttpError(400, 'Für Planning Center sind keine OAuth-Zugangsdaten hinterlegt', 'no-app');
  return app;
}

export const pcoProvider: PlanningProvider = {
  key: 'pco',
  label: 'Planning Center',
  requiresApp: true,

  getAuthorizeUrl(state, redirectUri, app) {
    const params = new URLSearchParams({
      client_id: requireApp(app).clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      state,
    });
    return `${API}/oauth/authorize?${params}`;
  },

  async exchangeCode(code, redirectUri, maybeApp) {
    const app = requireApp(maybeApp);
    const body = await fetchJson(`${API}/oauth/token`, {
      service: 'Planning Center',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    return tokenResponse(body, app);
  },

  async refresh(tokens, maybeApp) {
    const app = maybeApp;
    if (!app) throw new HttpError(401, 'Planning Center: Zugangsdaten wurden geändert, bitte neu anmelden', 'reauth');
    if (!tokens.refreshToken) throw new HttpError(401, 'Planning Center: Sitzung abgelaufen, bitte neu anmelden', 'reauth');
    const body = await fetchJson(`${API}/oauth/token`, {
      service: 'Planning Center',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      }),
    });
    return tokenResponse(body, app);
  },

  createClient(tokens) {
    return new PcoClient(tokens.accessToken);
  },
};

class PcoClient implements PlanningClient {
  constructor(private accessToken: string) {}

  private async get(pathOrUrl: string, retry = true): Promise<JsonApiDoc> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (res.status === 429 && retry) {
      const wait = Number(res.headers.get('Retry-After') ?? '2');
      await new Promise((r) => setTimeout(r, Math.min(wait, 20) * 1000));
      return this.get(pathOrUrl, false);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.errors?.[0]?.detail ?? body?.errors?.[0]?.title ?? res.statusText;
      throw new HttpError(res.status === 401 ? 401 : 502, `Planning Center: ${detail}`, res.status === 401 ? 'reauth' : 'upstream');
    }
    return (await res.json()) as JsonApiDoc;
  }

  /** Lädt alle Seiten (max. `maxPages`) einer Liste. */
  private async getAll(path: string, maxPages = 10): Promise<{ data: JsonApiResource[]; included: JsonApiResource[] }> {
    const data: JsonApiResource[] = [];
    const included: JsonApiResource[] = [];
    let next: string | undefined = path;
    for (let i = 0; next && i < maxPages; i++) {
      const doc = await this.get(next);
      data.push(...(Array.isArray(doc.data) ? doc.data : [doc.data]));
      included.push(...(doc.included ?? []));
      next = doc.links?.next;
    }
    return { data, included };
  }

  async getIdentity(): Promise<PlanningIdentity> {
    const [me, org] = await Promise.all([this.get('/people/v2/me?include=emails'), this.get('/people/v2')]);
    const person = me.data as JsonApiResource;
    const orgData = org.data as JsonApiResource;
    const emails = (me.included ?? []).filter((r) => r.type === 'Email');
    const email = emails.find((e) => e.attributes.primary) ?? emails[0];
    return {
      org: {
        externalId: orgData.id,
        name: orgData.attributes.name,
        timeZone: orgData.attributes.time_zone,
        avatarUrl: orgData.attributes.avatar_url,
      },
      person: {
        externalId: person.id,
        name: person.attributes.name ?? `${person.attributes.first_name} ${person.attributes.last_name}`.trim(),
        email: email?.attributes.address,
        avatarUrl: person.attributes.avatar,
      },
    };
  }

  async listEventSources() {
    const { data } = await this.getAll('/services/v2/service_types?per_page=100');
    return data.map((st) => ({ id: st.id, name: st.attributes.name as string }));
  }

  async listEvents({ from, to, sourceIds, order = 'asc', limit = 100 }: Parameters<PlanningClient['listEvents']>[0]) {
    const sources = sourceIds?.length
      ? (await this.listEventSources()).filter((s) => sourceIds.includes(s.id))
      : await this.listEventSources();
    const filters: string[] = [];
    const params = new URLSearchParams({ per_page: String(Math.min(limit, 100)), order: order === 'asc' ? 'sort_date' : '-sort_date' });
    if (from) {
      filters.push('after');
      params.set('after', from.toISOString());
    }
    if (to) {
      filters.push('before');
      params.set('before', to.toISOString());
    }
    if (filters.length) params.set('filter', filters.join(','));

    const lists = await Promise.all(
      sources.map(async (source) => {
        const { data } = await this.getAll(`/services/v2/service_types/${source.id}/plans?${params}`, 2);
        return data.map<PlanningEventSummary>((plan) => ({
          id: `${source.id}:${plan.id}`,
          title: plan.attributes.title || plan.attributes.series_title || source.name,
          subtitle: [plan.attributes.series_title, plan.attributes.dates].filter(Boolean).join(' · '),
          sourceName: source.name,
          startsAt: plan.attributes.sort_date ?? null,
          url: plan.attributes.planning_center_url,
        }));
      }),
    );
    const all = lists.flat().sort((a, b) => {
      const diff = new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime();
      return order === 'asc' ? diff : -diff;
    });
    return all.slice(0, limit);
  }

  async getEvent(id: string): Promise<PlanningEventDetail> {
    const [serviceTypeId, planId] = id.split(':');
    if (!serviceTypeId || !planId) throw new HttpError(400, 'Ungültige Plan-ID');
    const base = `/services/v2/service_types/${serviceTypeId}/plans/${planId}`;

    const [serviceType, plan, items, team, notes] = await Promise.all([
      this.get(`/services/v2/service_types/${serviceTypeId}`),
      this.get(`${base}?include=series,plan_times`),
      this.getAll(`${base}/items?per_page=100&include=item_notes`),
      this.getAll(`${base}/team_members?per_page=100&include=team`),
      this.getAll(`${base}/notes?per_page=100`),
    ]);

    const st = serviceType.data as JsonApiResource;
    const p = plan.data as JsonApiResource;
    const series = plan.included?.find((r) => r.type === 'Series');
    const planTimes = (plan.included ?? [])
      .filter((r) => r.type === 'PlanTime')
      .map((t) => t.attributes)
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    const serviceTimes = planTimes.filter((t) => t.time_type === 'service');
    const serviceStart = serviceTimes[0]?.starts_at ?? p.attributes.sort_date ?? null;

    // Items mit berechneter Startzeit
    const itemNotes = new Map(items.included.filter((r) => r.type === 'ItemNote').map((n) => [n.id, n.attributes]));
    const sorted = [...items.data].sort((a, b) => a.attributes.sequence - b.attributes.sequence);
    const planItems: PlanningItem[] = computeItemTimes(
      sorted.map((it) => ({
        title: it.attributes.title ?? '',
        description: it.attributes.description ?? '',
        lengthSec: Number(it.attributes.length ?? 0),
        position: it.attributes.service_position ?? 'during',
      })),
      serviceStart,
    );

    const itemsVar: Record<string, unknown> = {};
    sorted.forEach((it, idx) => {
      const title = it.attributes.title;
      if (!title || itemsVar[title]) return;
      const noteRefs = it.relationships?.item_notes?.data;
      const noteObj: Record<string, string> = {};
      for (const ref of Array.isArray(noteRefs) ? noteRefs : []) {
        const n = itemNotes.get(ref.id);
        if (n) noteObj[n.category_name] = n.content;
      }
      itemsVar[title] = {
        title,
        description: it.attributes.description ?? '',
        details: it.attributes.html_details ?? '',
        type: it.attributes.item_type,
        length: it.attributes.length,
        startsAt: planItems[idx]?.startsAt,
        notes: noteObj,
      };
    });

    // Team-Mitglieder (ohne Absagen) nach Position und Team
    const teams = new Map(team.included.filter((r) => r.type === 'Team').map((t) => [t.id, t.attributes.name as string]));
    const people: Record<string, string[]> = {};
    const teamsVar: Record<string, string[]> = {};
    for (const m of team.data) {
      if (m.attributes.status === 'D') continue;
      const name = m.attributes.name as string;
      const position = (m.attributes.team_position_name as string) || 'Ohne Position';
      (people[position] ??= []).includes(name) || people[position].push(name);
      const teamRef = m.relationships?.team?.data;
      const teamName = teamRef && !Array.isArray(teamRef) ? teams.get(teamRef.id) : undefined;
      if (teamName) (teamsVar[teamName] ??= []).includes(name) || teamsVar[teamName].push(name);
    }

    const notesVar: Record<string, string> = {};
    for (const n of notes.data) notesVar[n.attributes.category_name] = n.attributes.content;

    const title = p.attributes.title || p.attributes.series_title || st.attributes.name;
    return {
      id,
      title,
      subtitle: p.attributes.series_title ?? undefined,
      sourceName: st.attributes.name,
      startsAt: serviceStart,
      url: p.attributes.planning_center_url,
      items: planItems,
      variables: {
        event: {
          id,
          title,
          planTitle: p.attributes.title ?? '',
          seriesTitle: p.attributes.series_title ?? '',
          serviceType: st.attributes.name,
          date: serviceStart,
          dates: p.attributes.dates,
          url: p.attributes.planning_center_url,
        },
        plan: p.attributes,
        series: series
          ? { ...series.attributes, title: series.attributes.title, artwork: series.attributes.artwork_original ?? series.attributes.artwork_for_plan }
          : { title: p.attributes.series_title ?? '' },
        serviceType: st.attributes,
        times: {
          service: serviceStart,
          services: serviceTimes.map((t) => t.starts_at),
          rehearsal: planTimes.find((t) => t.time_type === 'rehearsal')?.starts_at ?? '',
        },
        people,
        teams: teamsVar,
        items: itemsVar,
        notes: notesVar,
      },
    };
  }

  async searchPeople(query: string) {
    const params = new URLSearchParams({ 'where[search_name_or_email]': query, include: 'emails', per_page: '25' });
    const doc = await this.get(`/people/v2/people?${params}`);
    const emails = new Map((doc.included ?? []).filter((r) => r.type === 'Email').map((e) => [e.id, e.attributes]));
    return (Array.isArray(doc.data) ? doc.data : [doc.data]).map((p) => {
      const refs = p.relationships?.emails?.data;
      const list = (Array.isArray(refs) ? refs : []).map((r) => emails.get(r.id)).filter(Boolean) as Record<string, any>[];
      return {
        externalId: p.id,
        name: p.attributes.name,
        email: (list.find((e) => e.primary) ?? list[0])?.address,
        avatarUrl: p.attributes.avatar,
      };
    });
  }
}

/**
 * Berechnet die Startzeit jedes Items:
 * - "pre"-Items liegen vor dem Gottesdienstbeginn (rückwärts gerechnet)
 * - "during"-Items ab Gottesdienstbeginn nacheinander
 * - "post"-Items danach
 */
export function computeItemTimes(
  items: { title: string; description?: string; lengthSec: number; position: string }[],
  serviceStart: string | null,
): PlanningItem[] {
  if (!serviceStart) return items.map((i) => ({ title: i.title, description: i.description, lengthSec: i.lengthSec, startsAt: null }));
  const start = new Date(serviceStart).getTime();
  const preTotal = items.filter((i) => i.position === 'pre').reduce((s, i) => s + i.lengthSec, 0);
  const duringTotal = items.filter((i) => i.position === 'during').reduce((s, i) => s + i.lengthSec, 0);
  let pre = start - preTotal * 1000;
  let during = start;
  let post = start + duringTotal * 1000;
  return items.map((i) => {
    let t: number;
    if (i.position === 'pre') {
      t = pre;
      pre += i.lengthSec * 1000;
    } else if (i.position === 'post') {
      t = post;
      post += i.lengthSec * 1000;
    } else {
      t = during;
      during += i.lengthSec * 1000;
    }
    return { title: i.title, description: i.description, lengthSec: i.lengthSec, startsAt: new Date(t).toISOString() };
  });
}
