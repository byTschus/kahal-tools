import { Router, type Request } from 'express';
import { z } from 'zod';
import { requirePerm, requireUser, tid } from '../auth/middleware.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';
import { consumeOAuthState, createOAuthState } from '../lib/session.js';
import { getPodcastHost, listPodcastHosts, type HostConfig } from '../providers/podcastHost/index.js';
import { getStreamingProvider, listStreamingProviders } from '../providers/streaming/index.js';
import { can } from '../permissions.js';
import { getIntegration, requireStreaming } from '../services/integrations.js';
import { appStatus, deleteTenantApp, redirectUriFor, resolveApp, saveTenantApp } from '../services/oauthApps.js';
import { feedUrl } from '../services/podcasts.js';

export const integrationsRouter = Router();


integrationsRouter.get('/api/integrations', requireUser, async (req, res) => {
  const tenantId = tid(req);
  const [streaming, host] = await Promise.all([getIntegration(tenantId, 'streaming'), getIntegration(tenantId, 'podcastHost')]);
  const hostProvider = host ? getPodcastHost(host.provider) : null;
  const secretKeys = new Set(hostProvider?.fields.filter((f) => f.secret).map((f) => f.key));
  const storedSecrets = decryptJson<HostConfig>(host?.secrets) ?? {};
  res.json({
    streaming: streaming ? { provider: streaming.provider, label: streaming.label, config: streaming.config, updatedAt: streaming.updatedAt } : null,
    podcastHost: host
      ? {
          provider: host.provider,
          config: host.config,
          // Geheimnisse nie zurückgeben, nur ob sie gesetzt sind
          secretsSet: Object.fromEntries([...secretKeys].map((k) => [k, Boolean(storedSecrets[k])])),
        }
      : null,
    available: { streaming: listStreamingProviders(), podcastHost: listPodcastHosts() },
    feedUrl: feedUrl(req.user!.tenant),
  });
});

// ----- Streaming (OAuth) -----

integrationsRouter.get('/api/integrations/streaming/:provider/connect', requirePerm('livestream', 'settings'), async (req, res) => {
  const provider = getStreamingProvider(String(req.params.provider));
  const app = await resolveApp(tid(req), provider.key);
  if (!app) {
    res.redirect(
      `/settings/livestream?error=${encodeURIComponent(`Für ${provider.label} sind auf dem Server noch keine API-Zugangsdaten hinterlegt. Bitte den Betreiber von kahal.tools kontaktieren.`)}`,
    );
    return;
  }
  const state = await createOAuthState(res, { purpose: 'streaming', provider: provider.key, tenantId: tid(req) });
  res.redirect(provider.getAuthorizeUrl(state, redirectUriFor(provider.key), app));
});

integrationsRouter.get('/api/integrations/streaming/:provider/callback', requirePerm('livestream', 'settings'), async (req, res) => {
  const back = (q: string) => res.redirect(`/settings/livestream?${q}`);
  try {
    if (req.query.error) return back(`error=${encodeURIComponent(String(req.query.error))}`);
    const state = await consumeOAuthState(req, res, req.query.state);
    const provider = getStreamingProvider(String(req.params.provider));
    if (state.purpose !== 'streaming' || state.tenantId !== tid(req) || state.provider !== provider.key) throw new Error('Ungültiger Status');

    const app = await resolveApp(tid(req), provider.key);
    if (!app) throw new Error('Zugangsdaten fehlen');
    const secrets = await provider.exchangeCode(String(req.query.code ?? ''), redirectUriFor(provider.key), app);
    const account = await provider.createClient(secrets, app, async () => {}).getAccount();
    const data = {
      provider: provider.key,
      label: account.name,
      config: { accountId: account.id, accountName: account.name, avatarUrl: account.avatarUrl ?? null },
      secrets: encryptJson(secrets),
    };
    await prisma.integration.upsert({
      where: { tenantId_kind: { tenantId: tid(req), kind: 'streaming' } },
      create: { tenantId: tid(req), kind: 'streaming', ...data },
      update: data,
    });
    back('connected=1');
  } catch (err) {
    back(`error=${encodeURIComponent(err instanceof Error ? err.message : 'Verbindung fehlgeschlagen')}`);
  }
});

integrationsRouter.delete('/api/integrations/streaming', requirePerm('livestream', 'settings'), async (req, res) => {
  await prisma.integration.deleteMany({ where: { tenantId: tid(req), kind: 'streaming' } });
  res.json({ ok: true });
});

/** Streamschlüssel + Playlists für die Einstellungen */
integrationsRouter.get('/api/integrations/streaming/options', requirePerm('livestream', 'settings'), async (req, res) => {
  const { client } = await requireStreaming(tid(req));
  const [streamKeys, playlists] = await Promise.all([client.listStreamKeys(), client.listPlaylists()]);
  res.json({ streamKeys, playlists });
});

// ----- Podcast-Hosting (Formular) -----

const hostSchema = z.object({ provider: z.string(), config: z.record(z.string(), z.unknown()) });

/** Trennt Formularwerte in Konfiguration und Geheimnisse; leere Geheimnisse behalten den alten Wert. */
async function splitHostConfig(tenantId: string, input: z.infer<typeof hostSchema>) {
  const provider = getPodcastHost(input.provider);
  const existing = await getIntegration(tenantId, 'podcastHost');
  const oldSecrets = existing?.provider === provider.key ? (decryptJson<HostConfig>(existing.secrets) ?? {}) : {};
  const cfg: HostConfig = {};
  const secrets: HostConfig = {};
  for (const field of provider.fields) {
    const value = input.config[field.key];
    if (field.secret) secrets[field.key] = value ? value : oldSecrets[field.key];
    else cfg[field.key] = value ?? field.default ?? null;
    if (field.required && !(field.secret ? secrets[field.key] : cfg[field.key])) throw new HttpError(400, `Feld "${field.label}" ist erforderlich`);
  }
  return { provider, cfg, secrets };
}

integrationsRouter.put('/api/integrations/podcastHost', requirePerm('podcast', 'settings'), async (req, res) => {
  const tenantId = tid(req);
  const { provider, cfg, secrets } = await splitHostConfig(tenantId, hostSchema.parse(req.body));
  const data = { provider: provider.key, label: provider.label, config: cfg, secrets: encryptJson(secrets) };
  await prisma.integration.upsert({
    where: { tenantId_kind: { tenantId, kind: 'podcastHost' } },
    create: { tenantId, kind: 'podcastHost', ...data },
    update: data,
  });
  res.json({ ok: true });
});

integrationsRouter.post('/api/integrations/podcastHost/test', requirePerm('podcast', 'settings'), async (req, res) => {
  const { provider, cfg, secrets } = await splitHostConfig(tid(req), hostSchema.parse(req.body));
  try {
    res.json({ ok: true, message: await provider.test(cfg, secrets) });
  } catch (err) {
    res.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.delete('/api/integrations/podcastHost', requirePerm('podcast', 'settings'), async (req, res) => {
  await prisma.integration.deleteMany({ where: { tenantId: tid(req), kind: 'podcastHost' } });
  res.json({ ok: true });
});

// ----- Eigene OAuth-App-Zugangsdaten der Gemeinde (Planning Center, Google/YouTube) -----

/** Wer darf welche Zugangsdaten verwalten? pco: Admins; youtube: Livestream-Einstellungen */
function checkAppAccess(req: Request, provider: string) {
  if (provider === 'pco') {
    if (!req.user!.isAdmin) throw new HttpError(403, 'Nur für Administratoren');
  } else if (provider === 'youtube') {
    if (!can(req.perms!, 'livestream', 'settings')) throw new HttpError(403, 'Keine Berechtigung');
  } else {
    throw new HttpError(404, 'Unbekannter Anbieter');
  }
}

integrationsRouter.get('/api/oauth-apps', requireUser, async (req, res) => {
  const tenant = req.user!.tenant;
  res.json({
    pco: await appStatus(tenant.id, 'pco'),
    youtube: await appStatus(tenant.id, 'youtube'),
    loginUrl: `${config.appUrl}/login/${tenant.slug}`,
  });
});

const appSchema = z.object({ clientId: z.string().trim().min(10, 'Client ID fehlt'), clientSecret: z.string().optional() });

integrationsRouter.put('/api/oauth-apps/:provider', requireUser, async (req, res) => {
  const provider = String(req.params.provider);
  checkAppAccess(req, provider);
  const body = appSchema.parse(req.body);
  await saveTenantApp(tid(req), provider, body.clientId, body.clientSecret);
  res.json(await appStatus(tid(req), provider));
});

integrationsRouter.delete('/api/oauth-apps/:provider', requireUser, async (req, res) => {
  const provider = String(req.params.provider);
  checkAppAccess(req, provider);
  if (provider === 'pco' && !(await resolveApp(null, 'pco'))) {
    throw new HttpError(400, 'Ohne eigene Planning-Center-Zugangsdaten könnte sich niemand mehr anmelden');
  }
  await deleteTenantApp(tid(req), provider);
  res.json(await appStatus(tid(req), provider));
});
