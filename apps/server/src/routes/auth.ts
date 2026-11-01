import { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { encryptJson } from '../lib/crypto.js';
import { clearSession, consumeOAuthState, createOAuthState, setSession } from '../lib/session.js';
import { slugify } from '../lib/template.js';
import { getPlanningProvider, listPlanningProviders, type PlanningIdentity, type PlanningTokens } from '../providers/planning/index.js';
import { MOCK_PEOPLE } from '../providers/planning/mock.js';

export const authRouter = Router();

const redirectUri = (provider: string) => `${config.appUrl}/auth/${provider}/callback`;

authRouter.get('/auth/providers', (_req, res) => {
  res.json(listPlanningProviders().filter((p) => p.configured));
});

authRouter.get('/auth/:provider/login', async (req, res) => {
  const provider = getPlanningProvider(String(req.params.provider));
  if (!provider.isConfigured()) {
    res.redirect(`/login?error=${encodeURIComponent(`${provider.label} ist auf dem Server noch nicht konfiguriert`)}`);
    return;
  }
  const state = await createOAuthState(res, { purpose: 'login', provider: provider.key });
  res.redirect(provider.getAuthorizeUrl(state, redirectUri(provider.key)));
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
  const fail = (msg: string) => res.redirect(`/login?error=${encodeURIComponent(msg)}`);
  try {
    if (req.query.error) return fail(String(req.query.error_description ?? req.query.error));
    const state = await consumeOAuthState(req, res, req.query.state);
    const provider = getPlanningProvider(String(req.params.provider));
    if (state.purpose !== 'login' || state.provider !== provider.key) return fail('Ungültiger Login-Status');

    const tokens = await provider.exchangeCode(String(req.query.code ?? ''), redirectUri(provider.key));
    const identity = await provider.createClient(tokens).getIdentity();
    const user = await loginUser(provider.key, identity, tokens);
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
        slug: await uniqueSlug(identity.org.name),
        name: identity.org.name,
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
    data: { name: identity.org.name, timeZone: identity.org.timeZone ?? tenant.timeZone, avatarUrl: identity.org.avatarUrl ?? tenant.avatarUrl },
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
