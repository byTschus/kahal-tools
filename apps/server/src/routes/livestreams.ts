import express, { Router } from 'express';
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
    playlistId: settings.playlistId || null,
    thumbnailUrl: render(settings.thumbnailTemplate, vars, opts).trim() || null,
  });
});

const streamSchema = z.object({
  eventId: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
  title: z.string().trim().min(1, 'Titel fehlt').max(100, 'Titel max. 100 Zeichen'),
  description: z.string().max(5000).default(''),
  scheduledStart: z.string().datetime({ offset: true }),
  privacy: z.enum(['public', 'unlisted', 'private']),
  /** Stream zu dieser Playlist hinzufügen */
  playlistId: z.string().nullable().optional(),
});

/** Fügt den Stream einer Playlist hinzu; ein Fehler verhindert das Speichern nicht, sondern wird gemeldet */
async function addToPlaylist(client: Awaited<ReturnType<typeof requireStreaming>>['client'], videoId: string, playlistId?: string | null) {
  if (!playlistId) return undefined;
  try {
    await client.addToPlaylist(videoId, playlistId);
    return undefined;
  } catch (err) {
    return `Der Stream konnte nicht zur Playlist hinzugefügt werden: ${err instanceof Error ? err.message : err}`;
  }
}

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
  const warning = await addToPlaylist(client, broadcast.id, body.playlistId);
  res.status(201).json({ ...broadcast, warning });
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
  const warning = await addToPlaylist(client, broadcast.id, body.playlistId);
  res.json({ ...broadcast, warning });
});

// ----- Playlists -----

livestreamsRouter.get('/api/livestreams/playlists', requirePerm('livestream', 'create'), async (req, res) => {
  const { client } = await requireStreaming(tid(req));
  res.json(await client.listPlaylists());
});

const playlistSchema = z.object({ name: z.string().trim().min(1, 'Name fehlt').max(150), privacy: z.enum(['public', 'unlisted', 'private']).default('public') });

livestreamsRouter.post('/api/livestreams/playlists', requirePerm('livestream', 'create'), async (req, res) => {
  const body = playlistSchema.parse(req.body);
  const { client } = await requireStreaming(tid(req));
  res.status(201).json(await client.createPlaylist(body.name, body.privacy));
});

// ----- Thumbnail -----

const MAX_THUMBNAIL = 2 * 1024 * 1024;

/** Bild (JPEG/PNG, max. 2 MB – YouTube-Limit) als Thumbnail setzen. Der Browser verkleinert vorher auf 1280×720. */
livestreamsRouter.put(
  '/api/livestreams/:id/thumbnail',
  requirePerm('livestream', 'edit'),
  express.raw({ type: ['image/jpeg', 'image/png'], limit: '3mb' }),
  async (req, res) => {
    const image = req.body as Buffer;
    if (!Buffer.isBuffer(image) || !image.length) throw new HttpError(400, 'Bitte ein JPEG- oder PNG-Bild hochladen');
    if (image.length > MAX_THUMBNAIL) throw new HttpError(400, 'Das Bild ist grösser als 2 MB');
    const { client } = await requireStreaming(tid(req));
    await client.setThumbnail(String(req.params.id), image, String(req.headers['content-type']));
    res.json({ ok: true });
  },
);

/**
 * Lädt ein Bild (z.B. Serienbild aus dem Plan) über den Server, damit der Browser es zuschneiden kann
 * (fremde Bilder dürfen ohne CORS nicht in ein Canvas gelesen werden).
 */
livestreamsRouter.get('/api/livestreams/image', requirePerm('livestream', 'create'), async (req, res) => {
  let url: URL;
  try {
    url = new URL(String(req.query.url ?? ''));
  } catch {
    throw new HttpError(400, 'Ungültige Bild-Adresse');
  }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'Ungültige Bild-Adresse');
  const upstream = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const type = upstream?.headers.get('content-type') ?? '';
  if (!upstream?.ok || !type.startsWith('image/')) throw new HttpError(400, 'Das Bild konnte nicht geladen werden');
  const data = Buffer.from(await upstream.arrayBuffer());
  if (data.length > 20 * 1024 * 1024) throw new HttpError(400, 'Das Bild ist zu gross');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.send(data);
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
