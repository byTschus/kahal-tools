import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, tid } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError, notFound } from '../lib/http.js';
import { effectivePermissions, sanitizePermissions } from '../permissions.js';
import { config } from '../config.js';
import { getPlanningProvider } from '../providers/planning/index.js';
import { inviteMail, mailEnabled, sendMail } from '../services/mail.js';
import { planningClientFor } from '../services/planning.js';
import type { Request } from 'express';

export const usersRouter = Router();
usersRouter.use('/api/users', requireAdmin);
usersRouter.use('/api/groups', requireAdmin);

const userInclude = { groups: { include: { group: true } } } as const;

function presentUser(u: any) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    isAdmin: u.isAdmin,
    status: u.status,
    permissions: sanitizePermissions(u.permissions),
    effectivePermissions: effectivePermissions(u),
    groupIds: u.groups.map((g: any) => g.groupId),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

const loginUrlOf = (req: Request) => `${config.appUrl}/login/${req.user!.tenant.slug}`;

type InviteMailResult = { status: 'sent' | 'disabled' | 'no-email' | 'failed'; error?: string; loginUrl: string };

/** Schickt die Einladungs-E-Mail; Fehler verhindern die Einladung nicht, sondern werden zurückgemeldet */
async function sendInvite(req: Request, user: { name: string; email: string | null }): Promise<InviteMailResult> {
  const loginUrl = loginUrlOf(req);
  if (!mailEnabled()) return { status: 'disabled', loginUrl };
  if (!user.email) return { status: 'no-email', loginUrl };
  const tenant = req.user!.tenant;
  const mail = inviteMail({
    name: user.name,
    churchName: tenant.name,
    inviterName: req.user!.name,
    planningLabel: getPlanningProvider(tenant.planningProvider).label,
    loginUrl,
  });
  try {
    await sendMail({ to: user.email, replyTo: req.user!.email ?? undefined, ...mail });
    return { status: 'sent', loginUrl };
  } catch (err) {
    console.warn('Einladungs-E-Mail fehlgeschlagen:', err instanceof Error ? err.message : err);
    return { status: 'failed', error: err instanceof Error ? err.message : String(err), loginUrl };
  }
}

/** Ob E-Mails verschickt werden können und der Login-Link der Gemeinde */
usersRouter.get('/api/users/invite-info', async (req, res) => {
  res.json({ mailEnabled: mailEnabled(), loginUrl: loginUrlOf(req) });
});

usersRouter.get('/api/users', async (req, res) => {
  const users = await prisma.user.findMany({ where: { tenantId: tid(req) }, include: userInclude, orderBy: { name: 'asc' } });
  res.json(users.map(presentUser));
});

/** Personen im Planungstool suchen (zum Einladen) */
usersRouter.get('/api/users/search-people', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const client = await planningClientFor(req.user!);
  const people = await client.searchPeople(q);
  const existing = new Set(
    (await prisma.user.findMany({ where: { tenantId: tid(req) }, select: { externalPersonId: true } })).map((u) => u.externalPersonId),
  );
  res.json(people.map((p) => ({ ...p, alreadyAdded: existing.has(p.externalId) })));
});

const inviteSchema = z.object({
  externalPersonId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional().nullable(),
  avatarUrl: z.string().optional().nullable(),
  permissions: z.unknown().optional(),
  groupIds: z.array(z.string()).default([]),
});

usersRouter.post('/api/users/invite', async (req, res) => {
  const body = inviteSchema.parse(req.body);
  const tenantId = tid(req);
  const exists = await prisma.user.findUnique({ where: { tenantId_externalPersonId: { tenantId, externalPersonId: body.externalPersonId } } });
  if (exists) throw new HttpError(409, 'Diese Person ist bereits eingetragen');
  const groups = await prisma.group.findMany({ where: { tenantId, id: { in: body.groupIds } } });
  const user = await prisma.user.create({
    data: {
      tenantId,
      externalPersonId: body.externalPersonId,
      name: body.name,
      email: body.email ?? null,
      avatarUrl: body.avatarUrl ?? null,
      status: 'invited',
      permissions: sanitizePermissions(body.permissions),
      groups: { create: groups.map((g) => ({ groupId: g.id })) },
    },
    include: userInclude,
  });
  res.status(201).json({ ...presentUser(user), invite: await sendInvite(req, user) });
});

/** Einladungs-E-Mail erneut senden (nur für Personen, die sich noch nicht angemeldet haben) */
usersRouter.post('/api/users/:id/invite-mail', async (req, res) => {
  const user = await prisma.user.findFirst({ where: { id: String(req.params.id), tenantId: tid(req) } });
  if (!user) throw notFound('Benutzer');
  if (user.status !== 'invited') throw new HttpError(400, 'Diese Person hat sich bereits angemeldet');
  res.json(await sendInvite(req, user));
});

const updateSchema = z.object({
  isAdmin: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  permissions: z.unknown().optional(),
  groupIds: z.array(z.string()).optional(),
});

async function assertAdminRemains(tenantId: string, excludingUserId: string) {
  const admins = await prisma.user.count({ where: { tenantId, isAdmin: true, status: 'active', id: { not: excludingUserId } } });
  if (admins === 0) throw new HttpError(400, 'Es muss mindestens ein aktiver Administrator bleiben');
}

usersRouter.patch('/api/users/:id', async (req, res) => {
  const body = updateSchema.parse(req.body);
  const tenantId = tid(req);
  const user = await prisma.user.findFirst({ where: { id: String(req.params.id), tenantId } });
  if (!user) throw notFound('Benutzer');
  if (user.isAdmin && (body.isAdmin === false || body.status === 'disabled')) await assertAdminRemains(tenantId, user.id);

  if (body.groupIds) {
    const groups = await prisma.group.findMany({ where: { tenantId, id: { in: body.groupIds } } });
    await prisma.groupMember.deleteMany({ where: { userId: user.id } });
    await prisma.groupMember.createMany({ data: groups.map((g) => ({ groupId: g.id, userId: user.id })) });
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      isAdmin: body.isAdmin,
      status: body.status,
      permissions: body.permissions !== undefined ? sanitizePermissions(body.permissions) : undefined,
    },
    include: userInclude,
  });
  res.json(presentUser(updated));
});

usersRouter.delete('/api/users/:id', async (req, res) => {
  const tenantId = tid(req);
  const user = await prisma.user.findFirst({ where: { id: String(req.params.id), tenantId } });
  if (!user) throw notFound('Benutzer');
  if (user.id === req.user!.id) throw new HttpError(400, 'Du kannst dich nicht selbst löschen');
  if (user.isAdmin) await assertAdminRemains(tenantId, user.id);
  await prisma.user.delete({ where: { id: user.id } });
  res.json({ ok: true });
});

// ----- Gruppen -----

const groupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  permissions: z.unknown().optional(),
  memberIds: z.array(z.string()).optional(),
});

async function presentGroups(tenantId: string) {
  const groups = await prisma.group.findMany({ where: { tenantId }, include: { members: true }, orderBy: { name: 'asc' } });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    permissions: sanitizePermissions(g.permissions),
    memberIds: g.members.map((m) => m.userId),
  }));
}

async function setMembers(tenantId: string, groupId: string, memberIds?: string[]) {
  if (!memberIds) return;
  const users = await prisma.user.findMany({ where: { tenantId, id: { in: memberIds } }, select: { id: true } });
  await prisma.groupMember.deleteMany({ where: { groupId } });
  await prisma.groupMember.createMany({ data: users.map((u) => ({ groupId, userId: u.id })) });
}

usersRouter.get('/api/groups', async (req, res) => {
  res.json(await presentGroups(tid(req)));
});

usersRouter.post('/api/groups', async (req, res) => {
  const body = groupSchema.parse(req.body);
  const tenantId = tid(req);
  if (await prisma.group.findFirst({ where: { tenantId, name: body.name } })) throw new HttpError(409, 'Eine Gruppe mit diesem Namen existiert bereits');
  const group = await prisma.group.create({ data: { tenantId, name: body.name, permissions: sanitizePermissions(body.permissions) } });
  await setMembers(tenantId, group.id, body.memberIds);
  res.status(201).json((await presentGroups(tenantId)).find((g) => g.id === group.id));
});

usersRouter.patch('/api/groups/:id', async (req, res) => {
  const body = groupSchema.partial().parse(req.body);
  const tenantId = tid(req);
  const group = await prisma.group.findFirst({ where: { id: String(req.params.id), tenantId } });
  if (!group) throw notFound('Gruppe');
  await prisma.group.update({
    where: { id: group.id },
    data: { name: body.name, permissions: body.permissions !== undefined ? sanitizePermissions(body.permissions) : undefined },
  });
  await setMembers(tenantId, group.id, body.memberIds);
  res.json((await presentGroups(tenantId)).find((g) => g.id === group.id));
});

usersRouter.delete('/api/groups/:id', async (req, res) => {
  const { count } = await prisma.group.deleteMany({ where: { id: String(req.params.id), tenantId: tid(req) } });
  if (!count) throw notFound('Gruppe');
  res.json({ ok: true });
});
