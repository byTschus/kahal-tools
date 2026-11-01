import { HttpError } from '../../lib/http.js';

/**
 * Minimaler OpenStack-Client (Keystone v3 + Nova) zum Starten und Stoppen des Worker-Servers.
 * Authentifizierung per Application Credential, damit kein Passwort gespeichert werden muss.
 * Getestet mit der Infomaniak Public Cloud, funktioniert mit jeder OpenStack-Cloud.
 */

export const DEFAULT_AUTH_URL = 'https://api.pub1.infomaniak.cloud/identity/v3';

export interface OpenStackCreds {
  authUrl: string;
  region?: string | null;
  appCredId: string;
  appCredSecret: string;
}

export interface ServerInfo {
  id: string;
  name: string;
  /** ACTIVE | SHUTOFF | BUILD | REBOOT | SHELVED | SHELVED_OFFLOADED | ERROR | ... */
  status: string;
  /** z.B. powering-on, powering-off – null, wenn nichts läuft */
  taskState: string | null;
}

interface Session {
  token: string;
  computeUrl: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

async function request(url: string, init: RequestInit & { token?: string } = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.token ? { 'X-Auth-Token': init.token } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    // Keystone: {error: {message}}, Nova: {itemNotFound: {message}}, {conflictingRequest: {message}}, ...
    const inner = body && typeof body === 'object' ? (body.error ?? Object.values(body)[0]) : undefined;
    const detail = (inner as any)?.message ?? res.statusText;
    const err = new HttpError(res.status === 401 || res.status === 404 ? 400 : 502, `OpenStack: ${detail}`, 'upstream');
    (err as any).upstreamStatus = res.status;
    throw err;
  }
  return { res, body };
}

function normalizeAuthUrl(url: string) {
  const u = (url || DEFAULT_AUTH_URL).trim().replace(/\/+$/, '');
  return /\/v3$/.test(u) ? u : `${u}/v3`;
}

async function session(creds: OpenStackCreds, fresh = false): Promise<Session> {
  const key = `${creds.authUrl}|${creds.appCredId}|${creds.region ?? ''}`;
  const cached = sessions.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached;

  const { res, body } = await request(`${normalizeAuthUrl(creds.authUrl)}/auth/tokens`, {
    method: 'POST',
    body: JSON.stringify({
      auth: { identity: { methods: ['application_credential'], application_credential: { id: creds.appCredId, secret: creds.appCredSecret } } },
    }),
  });
  const token = res.headers.get('x-subject-token');
  if (!token) throw new HttpError(502, 'OpenStack: Kein Token erhalten');

  const compute = (body?.token?.catalog ?? []).find((s: any) => s.type === 'compute');
  const endpoints: any[] = (compute?.endpoints ?? []).filter((e: any) => e.interface === 'public');
  const endpoint = creds.region ? endpoints.find((e) => e.region_id === creds.region || e.region === creds.region) : endpoints[0];
  if (!endpoint) {
    const regions = [...new Set(endpoints.map((e) => e.region_id ?? e.region))].join(', ');
    throw new HttpError(400, creds.region ? `OpenStack: Region „${creds.region}“ nicht gefunden (verfügbar: ${regions || 'keine'})` : 'OpenStack: Kein Compute-Dienst gefunden');
  }

  const s: Session = { token, computeUrl: String(endpoint.url).replace(/\/+$/, ''), expiresAt: Date.parse(body?.token?.expires_at) || Date.now() + 3600_000 };
  sessions.set(key, s);
  return s;
}

/** Aufruf der Compute-API; bei abgelaufenem Token einmal neu anmelden. */
async function compute(creds: OpenStackCreds, path: string, init: RequestInit = {}) {
  let s = await session(creds);
  try {
    return (await request(`${s.computeUrl}${path}`, { ...init, token: s.token })).body;
  } catch (err) {
    if ((err as any)?.upstreamStatus !== 401) throw err;
    s = await session(creds, true);
    return (await request(`${s.computeUrl}${path}`, { ...init, token: s.token })).body;
  }
}

const toInfo = (s: any): ServerInfo => ({ id: s.id, name: s.name, status: s.status, taskState: s['OS-EXT-STS:task_state'] ?? null });

export async function listServers(creds: OpenStackCreds): Promise<ServerInfo[]> {
  const body = await compute(creds, '/servers/detail');
  return (body?.servers ?? []).map(toInfo);
}

export async function getServer(creds: OpenStackCreds, id: string): Promise<ServerInfo> {
  const body = await compute(creds, `/servers/${encodeURIComponent(id)}`);
  return toInfo(body.server);
}

/** Startet einen gestoppten (oder abgelegten) Server. Gibt false zurück, wenn nichts zu tun war. */
export async function startServer(creds: OpenStackCreds, id: string) {
  const server = await getServer(creds, id);
  if (server.taskState) return false;
  const action = server.status === 'SHUTOFF' ? { 'os-start': null } : server.status.startsWith('SHELVED') ? { unshelve: null } : null;
  if (!action) return false;
  await compute(creds, `/servers/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify(action) });
  return true;
}

/** Fährt den Server sauber herunter (ACPI). Gestoppte Instanzen kosten bei Infomaniak nur noch den Speicher. */
export async function stopServer(creds: OpenStackCreds, id: string) {
  const server = await getServer(creds, id);
  if (server.taskState || server.status !== 'ACTIVE') return false;
  await compute(creds, `/servers/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify({ 'os-stop': null }) });
  return true;
}
