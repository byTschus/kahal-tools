import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';
import { clearSession, consumeOAuthState, createOAuthState, setSession } from '../lib/session.js';
import { slugify } from '../lib/template.js';
import { getPlanningProvider, listPlanningProviders, type OAuthAppCreds, type PlanningIdentity, type PlanningTokens } from '../providers/planning/index.js';
import { MOCK_PEOPLE } from '../providers/planning/mock.js';
import { redirectUriFor, resolveApp, saveTenantApp } from '../services/oauthApps.js';

export const authRouter = Router();

/**
 * Login-Varianten:
 * 1. /auth/pco/login?tenant=<slug>  -> mit der eigenen OAuth-App der Gemeinde (Login-Link der Gemeinde)
 * 2. /auth/pco/login                -> mit der globalen App aus der .env (falls gesetzt)
 * 3. POST /auth/pco/setup           -> neue Gemeinde einrichten: Client ID/Secret eingeben, danach Login.
 *                                     Die Zugangsdaten werden nach erfolgreichem Login bei der Gemeinde gespeichert.
 */

authRouter.get('/auth/providers', (_req, res) => {
  res.json(listPlanningProviders());
});

/** Öffentliche Infos für die Login-Seite einer Gemeinde */
authRouter.get('/auth/tenant/:slug', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { slug: String(req.params.slug) }, include: { oauthApps: { select: { provider: true } } } });
  if (!tenant) throw new HttpError(404, 'Gemeinde nicht gefunden');
  const provider = getPlanningProvider(tenant.planningProvider);
  res.json({
    name: tenant.name,
    slug: tenant.slug,
    avatarUrl: tenant.avatarUrl,
    provider: { key: provider.key, label: provider.label },
    ready: !provider.requiresApp || tenant.oauthApps.some((a) => a.provider === provider.key) || Boolean(await resolveApp(null, provider.key)),
  });
});

const loginPage = (slug?: string) => (slug ? `/login/${encodeURIComponent(slug)}` : '/login');

authRouter.get('/auth/:provider/login', async (req, res) => {
  const provider = getPlanningProvider(String(req.params.provider));
  const slug = req.query.tenant ? String(req.query.tenant) : undefined;
  const tenant = slug ? await prisma.tenant.findUnique({ where: { slug } }) : null;
  if (slug && !tenant) {
    res.redirect(`/login?error=${encodeURIComponent('Gemeinde nicht gefunden')}`);
    return;
  }
  const app = provider.requiresApp ? await resolveApp(tenant?.id ?? null, provider.key) : null;
  if (provider.requiresApp && !app) {
    res.redirect(`${loginPage(slug)}?error=${encodeURIComponent(`Für ${provider.label} sind noch keine Zugangsdaten hinterlegt. Neue Gemeinde? Bitte „Gemeinde einrichten“ wählen.`)}`);
    return;
  }
  const state = await createOAuthState(res, { purpose: 'login', provider: provider.key, ...(slug ? { tenant: slug } : {}) });
  res.redirect(provider.getAuthorizeUrl(state, redirectUriFor(provider.key), app));
});

const setupSchema = z.object({ clientId: z.string().trim().min(10, 'Client ID fehlt'), clientSecret: z.string().trim().min(10, 'Secret fehlt') });

/** Neue Gemeinde einrichten: eigene OAuth-App-Zugangsdaten, danach Login beim Planungstool */
authRouter.post('/auth/:provider/setup', async (req, res) => {
  const provider = getPlanningProvider(String(req.params.provider));
  const app = setupSchema.parse(req.body);
  const state = await createOAuthState(res, { purpose: 'setup', provider: provider.key, app: encryptJson(app) });
  res.json({ url: provider.getAuthorizeUrl(state, redirectUriFor(provider.key), app) });
});

// Auswahlseite für den Demo-Login (nur lokal)
authRouter.get('/auth/mock/choose', (req, res) => {
  if (!config.enableMockPlanning) {
    res.status(404).end();
    return;
  }
  const state = encodeURIComponent(String(req.query.state ?? ''));
  const links = MOCK_PEOPLE.map(
    (p) => `<li><a href="/auth/mock/callback?code=${p.externalId}&state=${state}">${p.name}</a> <small>${p.email}</small></li>`,
  ).join('');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Demo-Login</title>
<body style="font-family:system-ui;max-width:420px;margin:60px auto;line-height:1.6">
<h2>Demo-Login</h2><p>Als welche Person der <b>Demo-Gemeinde</b> möchtest du dich anmelden?</p><ul>${links}</ul>
<p><small>Die erste Person, die sich anmeldet, wird Administrator.</small></p></body>`);
});

authRouter.get('/auth/:provider/callback', async (req, res) => {
  let back = '/login';
  const fail = (msg: string) => res.redirect(`${back}?error=${encodeURIComponent(msg)}`);
  try {
    const state = await consumeOAuthState(req, res, req.query.state);
    if (state.tenant) back = loginPage(state.tenant);
    if (state.purpose === 'setup') back = '/setup';
    if (req.query.error) return fail(String(req.query.error_description ?? req.query.error));
    const provider = getPlanningProvider(String(req.params.provider));
    if (!['login', 'setup'].includes(state.purpose) || state.provider !== provider.key) return fail('Ungültiger Login-Status');

    const tenant = state.tenant ? await prisma.tenant.findUnique({ where: { slug: state.tenant } }) : null;
    const setupApp = state.purpose === 'setup' ? decryptJson<OAuthAppCreds>(state.app) : null;
    const app = provider.requiresApp ? (setupApp ?? (await resolveApp(tenant?.id ?? null, provider.key))) : null;

    const tokens = await provider.exchangeCode(String(req.query.code ?? ''), redirectUriFor(provider.key), app);
    const identity = await provider.createClient(tokens).getIdentity();

    if (tenant && tenant.externalOrgId !== identity.org.externalId) {
      return fail(identity.org.name ? `Dieses ${provider.label}-Konto gehört zu „${identity.org.name}“, nicht zu „${tenant.name}“.` : `Dieses ${provider.label}-Konto gehört nicht zu „${tenant.name}“.`);
    }
    if (setupApp) {
      const existing = await prisma.tenant.findUnique({
        where: { planningProvider_externalOrgId: { planningProvider: provider.key, externalOrgId: identity.org.externalId } },
      });
      if (existing) {
        const admin = await prisma.user.findFirst({
          where: { tenantId: existing.id, externalPersonId: identity.person.externalId, isAdmin: true, status: 'active' },
        });
        if (!admin) {
          back = loginPage(existing.slug);
          return fail(`„${existing.name}“ ist bereits eingerichtet. Bitte über diesen Login-Link anmelden; Zugangsdaten kann nur ein Administrator ändern.`);
        }
      }
    }

    const user = await loginUser(provider.key, identity, tokens);
    if (setupApp) await saveTenantApp(user.tenantId, provider.key, setupApp.clientId, setupApp.clientSecret);
    await setSession(res, { uid: user.id, tid: user.tenantId });
    res.redirect(user.status === 'active' ? '/' : '/pending');
  } catch (err) {
    console.error('Login fehlgeschlagen', err);
    fail(err instanceof Error ? err.message : 'Login fehlgeschlagen');
  }
});

authRouter.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

async function uniqueSlug(name: string) {
  const base = slugify(name, 40) || 'gemeinde';
  for (let i = 0; ; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.tenant.findUnique({ where: { slug } }))) return slug;
  }
}

/**
 * Ordnet den Benutzer anhand der Organisation im Planungstool einer Gemeinde zu.
 * - Gemeinde existiert noch nicht -> wird angelegt, Benutzer wird Admin
 * - Benutzer wurde eingeladen -> wird aktiviert
 * - Unbekannter Benutzer -> Zugangsanfrage (status "pending"), Admin muss freischalten
 */
export async function loginUser(providerKey: string, identity: PlanningIdentity, tokens: PlanningTokens) {
  const planningAuth = encryptJson(tokens);
  const profile = {
    name: identity.person.name,
    email: identity.person.email ?? null,
    avatarUrl: identity.person.avatarUrl ?? null,
    planningAuth,
    lastLoginAt: new Date(),
  };

  const tenant = await prisma.tenant.findUnique({
    where: { planningProvider_externalOrgId: { planningProvider: providerKey, externalOrgId: identity.org.externalId } },
  });

  if (!tenant) {
    const created = await prisma.tenant.create({
      data: {
        slug: await uniqueSlug(identity.org.name ?? 'gemeinde'),
        name: identity.org.name ?? 'Gemeinde',
        planningProvider: providerKey,
        externalOrgId: identity.org.externalId,
        timeZone: identity.org.timeZone ?? 'Europe/Zurich',
        avatarUrl: identity.org.avatarUrl ?? null,
        users: { create: { externalPersonId: identity.person.externalId, isAdmin: true, status: 'active', ...profile } },
      },
      include: { users: true },
    });
    return created.users[0];
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { name: identity.org.name ?? tenant.name, timeZone: identity.org.timeZone ?? tenant.timeZone, avatarUrl: identity.org.avatarUrl ?? tenant.avatarUrl },
  });

  const existing = await prisma.user.findUnique({
    where: { tenantId_externalPersonId: { tenantId: tenant.id, externalPersonId: identity.person.externalId } },
  });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { ...profile, status: existing.status === 'invited' ? 'active' : existing.status },
    });
  }
  // Gemeinde ohne aktiven Admin (z.B. alle gelöscht) -> neuer Benutzer wird Admin
  const hasAdmin = await prisma.user.count({ where: { tenantId: tenant.id, isAdmin: true, status: 'active' } });
  return prisma.user.create({
    data: {
      tenantId: tenant.id,
      externalPersonId: identity.person.externalId,
      isAdmin: hasAdmin === 0,
      status: hasAdmin === 0 ? 'active' : 'pending',
      ...profile,
    },
  });
}
