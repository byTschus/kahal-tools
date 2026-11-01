import { Router } from 'express';
import { z } from 'zod';
import { requirePerm, tid } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';
import { render } from '../lib/template.js';
import { requireStreaming } from '../services/integrations.js';
import { assertPlanFree } from '../services/planLinks.js';
import { planningClientFor, resolveStartTime } from '../services/planning.js';
import { getSettings } from '../settings.js';

export const livestreamsRouter = Router();

livestreamsRouter.get('/api/livestreams', requirePerm('livestream', 'view'), async (req, res) => {
  const tenantId = tid(req);
  const status = z.enum(['upcoming', 'active', 'completed', 'all']).catch('upcoming').parse(req.query.status);
  const { client, provider } = await requireStreaming(tenantId);
  const { items, nextPageToken } = await client.listBroadcasts(status, req.query.pageToken ? String(req.query.pageToken) : undefined);
  const local = await prisma.livestream.findMany({
    where: { tenantId, provider: provider.key, externalId: { in: items.map((i) => i.id) } },
  });
  const byId = new Map(local.map((l) => [l.externalId, l]));
  res.json({
    items: items.map((b) => {
      const l = byId.get(b.id);
      return { ...b, planId: l?.planId ?? null, planTitle: l?.planTitle ?? null, peakConcurrent: l?.peakConcurrent ?? null, viewCount: l?.viewCount ?? null };
    }),
    nextPageToken,
  });
});

const prepareSchema = z.object({ eventId: z.string(), freitext: z.string().optional() });

/** Erstellt den Vorschlag (Titel, Beschreibung, Startzeit) aus einem Plan und den Einstellungen */
livestreamsRouter.post('/api/livestreams/prepare', requirePerm('livestream', 'create'), async (req, res) => {
  const body = prepareSchema.parse(req.body);
  const settings = await getSettings(tid(req), 'livestream');
  const event = await (await planningClientFor(req.user!)).getEvent(body.eventId);
  const vars = { ...event.variables, freitext: body.freitext ?? '' };
  const opts = { timeZone: req.user!.tenant.timeZone };
  const start = resolveStartTime(event, settings);
  res.json({
    event: { id: event.id, title: event.title, startsAt: event.startsAt, url: event.url },
    title: render(settings.titleTemplate, vars, opts).trim(),
    description: render(settings.descriptionTemplate, vars, opts).trim(),
    scheduledStart: start.startsAt,
    startSource: start.source,
    privacy: settings.privacy,
  });
});

const streamSchema = z.object({
  eventId: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
  title: z.string().trim().min(1, 'Titel fehlt').max(100, 'Titel max. 100 Zeichen'),
  description: z.string().max(5000).default(''),
  scheduledStart: z.string().datetime({ offset: true }),
  privacy: z.enum(['public', 'unlisted', 'private']),
});

livestreamsRouter.post('/api/livestreams', requirePerm('livestream', 'create'), async (req, res) => {
  const body = streamSchema.parse(req.body);
  const tenantId = tid(req);
  if (!body.eventId) throw new HttpError(400, 'Bitte einen Plan auswählen');
  await assertPlanFree('livestream', tenantId, body.eventId);
  if (new Date(body.scheduledStart).getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, 'Der Startzeitpunkt liegt in der Vergangenheit');
  const settings = await getSettings(tenantId, 'livestream');
  const { client, provider } = await requireStreaming(tenantId);
  const broadcast = await client.createBroadcast({
    title: body.title,
    description: body.description,
    scheduledStart: new Date(body.scheduledStart).toISOString(),
    privacy: body.privacy,
    streamKeyId: settings.streamKeyId || undefined,
    playlistId: settings.playlistId || undefined,
    autoStart: settings.autoStart,
    autoStop: settings.autoStop,
  });
  await prisma.livestream.create({
    data: {
      tenantId,
      provider: provider.key,
      externalId: broadcast.id,
      planId: body.eventId ?? null,
      planTitle: body.eventTitle ?? null,
      title: broadcast.title,
      scheduledStart: broadcast.scheduledStart ? new Date(broadcast.scheduledStart) : null,
      status: broadcast.status,
      createdById: req.user!.id,
    },
  });
  res.status(201).json(broadcast);
});

livestreamsRouter.patch('/api/livestreams/:id', requirePerm('livestream', 'edit'), async (req, res) => {
  const body = streamSchema.partial().parse(req.body);
  const tenantId = tid(req);
  const { client, provider } = await requireStreaming(tenantId);
  if (body.eventId) {
    const own = await prisma.livestream.findFirst({ where: { tenantId, provider: provider.key, externalId: String(req.params.id) }, select: { id: true } });
    await assertPlanFree('livestream', tenantId, body.eventId, own?.id);
  }
  const broadcast = await client.updateBroadcast(String(req.params.id), {
    title: body.title,
    description: body.description,
    scheduledStart: body.scheduledStart ? new Date(body.scheduledStart).toISOString() : undefined,
    privacy: body.privacy,
  });
  const data = {
    title: broadcast.title,
    scheduledStart: broadcast.scheduledStart ? new Date(broadcast.scheduledStart) : null,
    status: broadcast.status,
    ...(body.eventId !== undefined ? { planId: body.eventId, planTitle: body.eventTitle ?? null } : {}),
  };
  await prisma.livestream.upsert({
    where: { tenantId_provider_externalId: { tenantId, provider: provider.key, externalId: broadcast.id } },
    create: { tenantId, provider: provider.key, externalId: broadcast.id, ...data },
    update: data,
  });
  res.json(broadcast);
});

const linkSchema = z.object({ eventId: z.string().nullable(), eventTitle: z.string().nullable().optional() });

/** Plan verknüpfen oder lösen, ohne den Stream auf YouTube zu ändern (auch für vergangene Streams) */
livestreamsRouter.put('/api/livestreams/:id/plan', requirePerm('livestream', 'edit'), async (req, res) => {
  const body = linkSchema.parse(req.body);
  const tenantId = tid(req);
  const { client, provider } = await requireStreaming(tenantId);
  const externalId = String(req.params.id);
  const own = await prisma.livestream.findFirst({ where: { tenantId, provider: provider.key, externalId } });
  await assertPlanFree('livestream', tenantId, body.eventId, own?.id);
  const link = { planId: body.eventId, planTitle: body.eventId ? (body.eventTitle ?? null) : null };
  if (own) {
    await prisma.livestream.update({ where: { id: own.id }, data: link });
  } else {
    const broadcast = await client.getBroadcast(externalId);
    if (!broadcast) throw new HttpError(404, 'Livestream nicht gefunden');
    await prisma.livestream.create({
      data: {
        tenantId,
        provider: provider.key,
        externalId,
        title: broadcast.title,
        scheduledStart: broadcast.scheduledStart ? new Date(broadcast.scheduledStart) : null,
        status: broadcast.status,
        ...link,
      },
    });
  }
  res.json({ ok: true });
});

livestreamsRouter.delete('/api/livestreams/:id', requirePerm('livestream', 'delete'), async (req, res) => {
  const tenantId = tid(req);
  const { client, provider } = await requireStreaming(tenantId);
  await client.deleteBroadcast(String(req.params.id));
  await prisma.livestream.deleteMany({ where: { tenantId, provider: provider.key, externalId: String(req.params.id) } });
  res.json({ ok: true });
});
