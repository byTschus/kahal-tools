import { config } from '../config.js';
import { prisma } from '../db.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';

/**
 * OAuth-App-Zugangsdaten (Client ID + Secret) für Planungstools und Streaming-Plattformen.
 *
 * Planning Center: Jede Gemeinde kann im Webinterface eigene Zugangsdaten hinterlegen. Fehlen diese,
 * werden die globalen Werte aus der .env verwendet.
 * Google / YouTube: nur die globale App aus der .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) für alle Gemeinden.
 */
export interface OAuthAppCreds {
  clientId: string;
  clientSecret: string;
}

export type OAuthAppSource = 'tenant' | 'global';

/** Anbieter, bei denen eine Gemeinde eigene Zugangsdaten eintragen darf */
const TENANT_APP_PROVIDERS = ['pco'];
export const allowsTenantApp = (provider: string) => TENANT_APP_PROVIDERS.includes(provider);

export const OAUTH_REDIRECT_PATHS: Record<string, string> = {
  pco: '/auth/pco/callback',
  youtube: '/api/integrations/streaming/youtube/callback',
};

export function redirectUriFor(provider: string) {
  return `${config.appUrl}${OAUTH_REDIRECT_PATHS[provider] ?? `/auth/${provider}/callback`}`;
}

export function globalApp(provider: string): OAuthAppCreds | null {
  const env = provider === 'pco' ? config.pco : provider === 'youtube' ? config.google : null;
  return env?.clientId && env.clientSecret ? { clientId: env.clientId, clientSecret: env.clientSecret } : null;
}

export async function tenantApp(tenantId: string, provider: string): Promise<OAuthAppCreds | null> {
  const row = await prisma.oAuthApp.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
  if (!row) return null;
  return { clientId: row.clientId, clientSecret: decryptJson<string>(row.clientSecret) ?? '' };
}

/** Zugangsdaten für einen neuen OAuth-Vorgang: eigene App der Gemeinde, sonst global. */
export async function resolveApp(tenantId: string | null, provider: string): Promise<(OAuthAppCreds & { source: OAuthAppSource }) | null> {
  const own = tenantId && allowsTenantApp(provider) ? await tenantApp(tenantId, provider) : null;
  if (own) return { ...own, source: 'tenant' };
  const global = globalApp(provider);
  return global ? { ...global, source: 'global' } : null;
}

/**
 * Zugangsdaten zu einem bestehenden Token (für Token-Erneuerung): Es muss genau die App sein,
 * die das Token ausgestellt hat. Früher gespeicherte eigene Google-Apps bleiben dafür gültig,
 * bis die Gemeinde YouTube neu verbindet.
 */
export async function appForClientId(tenantId: string, provider: string, clientId: string | undefined): Promise<OAuthAppCreds | null> {
  const candidates = [await tenantApp(tenantId, provider), globalApp(provider)].filter(Boolean) as OAuthAppCreds[];
  if (!clientId) return candidates[0] ?? null;
  return candidates.find((c) => c.clientId === clientId) ?? null;
}

export async function saveTenantApp(tenantId: string, provider: string, clientId: string, clientSecret?: string) {
  if (!allowsTenantApp(provider)) throw new HttpError(400, 'Für diesen Dienst gelten die Zugangsdaten des Betreibers');
  const existing = await prisma.oAuthApp.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
  const secret = clientSecret?.trim() ? encryptJson(clientSecret.trim()) : existing?.clientSecret;
  if (!secret) throw new HttpError(400, 'Client Secret fehlt');
  await prisma.oAuthApp.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    create: { tenantId, provider, clientId: clientId.trim(), clientSecret: secret },
    update: { clientId: clientId.trim(), clientSecret: secret },
  });
}

export async function deleteTenantApp(tenantId: string, provider: string) {
  await prisma.oAuthApp.deleteMany({ where: { tenantId, provider } });
}

/** Status für die Einstellungen (ohne Secret) */
export async function appStatus(tenantId: string, provider: string) {
  const own = allowsTenantApp(provider) ? await prisma.oAuthApp.findUnique({ where: { tenantId_provider: { tenantId, provider } } }) : null;
  return {
    clientId: own?.clientId ?? '',
    secretSet: Boolean(own),
    source: (own ? 'tenant' : globalApp(provider) ? 'global' : null) as OAuthAppSource | null,
    redirectUri: redirectUriFor(provider),
  };
}
