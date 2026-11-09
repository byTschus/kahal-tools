import { config } from '../config.js';
import { prisma } from '../db.js';
import { decryptJson } from '../lib/crypto.js';

/**
 * OAuth-App-Zugangsdaten (Client ID + Secret) für Planungstools und Streaming-Plattformen.
 *
 * Es gibt nur noch eine App pro Anbieter für alle Gemeinden, hinterlegt in der Server-.env
 * (PCO_CLIENT_ID/SECRET, GOOGLE_CLIENT_ID/SECRET). Früher konnten Gemeinden eigene Apps eintragen;
 * diese liegen noch in der Tabelle OAuthApp und dienen nur noch zum Erneuern bestehender Tokens,
 * bis sich die Benutzer neu anmelden bzw. YouTube neu verbunden wird.
 */
export interface OAuthAppCreds {
  clientId: string;
  clientSecret: string;
}

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

/** Früher gespeicherte App einer Gemeinde (nur noch für die Token-Erneuerung) */
async function legacyTenantApp(tenantId: string, provider: string): Promise<OAuthAppCreds | null> {
  const row = await prisma.oAuthApp.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
  if (!row) return null;
  return { clientId: row.clientId, clientSecret: decryptJson<string>(row.clientSecret) ?? '' };
}

/** Zugangsdaten für einen neuen OAuth-Vorgang */
export function resolveApp(provider: string): OAuthAppCreds | null {
  return globalApp(provider);
}

/**
 * Zugangsdaten zu einem bestehenden Token (für Token-Erneuerung): Es muss genau die App sein,
 * die das Token ausgestellt hat.
 */
export async function appForClientId(tenantId: string, provider: string, clientId: string | undefined): Promise<OAuthAppCreds | null> {
  const global = globalApp(provider);
  if (!clientId || global?.clientId === clientId) return global ?? (await legacyTenantApp(tenantId, provider));
  const legacy = await legacyTenantApp(tenantId, provider);
  return legacy?.clientId === clientId ? legacy : null;
}
