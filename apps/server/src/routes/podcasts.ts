import { Router } from 'express';
import { z } from 'zod';
import { requirePerm, tid } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { randomToken } from '../lib/crypto.js';
import { HttpError, notFound } from '../lib/http.js';
import { render, slugify } from '../lib/template.js';
import { podcastHostFor, requirePodcastHost, requireStreaming } from '../services/integrations.js';
import { enqueueJob } from '../services/jobs.js';
import { planningClientFor } from '../services/planning.js';
import { PODCAST_JOB, syncFeed } from '../services/podcasts.js';
import { getSettings } from '../settings.js';

export const podcastsRouter = Router();

podcastsRouter.get('/api/podcasts', requirePerm('podcast', 'view'), async (req, res) => {
  const podcasts = await prisma.podcast.findMany({ where: { tenantId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 500 });
  res.json(podcasts);
});

/** Vergangene Livestreams als Quelle für neue Podcasts */
podcastsRouter.get('/api/podcasts/sources', requirePerm('podcast', 'create'), async (req, res) => {
  const tenantId = tid(req);
  const { client, provider } = await requireStreaming(tenantId);
  const { items, nextPageToken } = await client.listBroadcasts('completed', req.query.pageToken ? String(req.query.pageToken) : undefined);
  const [local, used] = await Promise.all([
    prisma.livestream.findMany({ where: { tenantId, provider: provider.key, externalId: { in: items.map((i) => i.id) } } }),
    prisma.podcast.findMany({ where: { tenantId, sourceVideoId: { in: items.map((i) => i.id) } }, select: { sourceVideoId: true } }),
  ]);
  const plans = new Map(local.map((l) => [l.externalId, l]));
  const usedIds = new Set(used.map((u) => u.sourceVideoId));
  res.json({
    items: items.map((b) => ({ ...b, planId: plans.get(b.id)?.planId ?? null, planTitle: plans.get(b.id)?.planTitle ?? null, hasPodcast: usedIds.has(b.id) })),
    nextPageToken,
  });
});

const prepareSchema = z.object({ videoId: z.string(), eventId: z.string().nullable().optional(), freitext: z.string().optional() });

podcastsRouter.post('/api/podcasts/prepare', requirePerm('podcast', 'create'), async (req, res) => {
  const body = prepareSchema.parse(req.body);
  const tenantId = tid(req);
  const { client, provider } = await requireStreaming(tenantId);
  const [broadcast, stats, local, settings] = await Promise.all([
    client.getBroadcast(body.videoId),
    client.getStats([body.videoId]),
    prisma.livestream.findFirst({ where: { tenantId, provider: provider.key, externalId: body.videoId } }),
    getSettings(tenantId, 'podcast'),
  ]);
  if (!broadcast) throw notFound('Video');
  const eventId = body.eventId ?? local?.planId ?? null;
  const event = eventId ? await (await planningClientFor(req.user!)).getEvent(eventId) : null;
  const vars = {
    ...(event?.variables ?? { event: { title: broadcast.title, date: broadcast.actualStart ?? broadcast.scheduledStart } }),
    video: { title: broadcast.title, description: broadcast.description, date: broadcast.actualStart ?? broadcast.scheduledStart },
    freitext: body.freitext ?? '',
  };
  const opts = { timeZone: req.user!.tenant.timeZone };
  res.json({
    eventId,
    event: event ? { id: event.id, title: event.title, startsAt: event.startsAt } : null,
    video: { ...broadcast, durationSec: stats[body.videoId]?.durationSec ?? null },
    title: render(settings.titleTemplate, vars, opts).trim() || broadcast.title,
    speaker: render(settings.speakerTemplate, vars, opts).trim(),
    description: render(settings.descriptionTemplate, vars, opts).trim(),
    imageUrl: render(settings.imageTemplate, vars, opts).trim() || settings.feed.imageUrl,
    fileName: slugify(render(settings.fileNameTemplate, vars, opts)) || 'podcast',
  });
});

const createSchema = z
  .object({
    videoId: z.string(),
    eventId: z.string().nullable().optional(),
    title: z.string().trim().min(1, 'Titel fehlt').max(255),
    speaker: z.string().max(190).default(''),
    description: z.string().default(''),
    imageUrl: z.string().default(''),
    fileName: z.string().default(''),
    startSec: z.number().int().min(0),
    endSec: z.number().int().positive(),
  })
  .refine((v) => v.endSec - v.startSec >= 10, { message: 'Der Ausschnitt muss mindestens 10 Sekunden lang sein' });

podcastsRouter.post('/api/podcasts', requirePerm('podcast', 'create'), async (req, res) => {
  const body = createSchema.parse(req.body);
  const tenantId = tid(req);
  await requirePodcastHost(tenantId);
  const { provider } = await requireStreaming(tenantId);
  const fileName = `${slugify(body.fileName || body.title, 100) || 'podcast'}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}.mp3`;
  const podcast = await prisma.podcast.create({
    data: {
      tenantId,
      sourceProvider: provider.key,
      sourceVideoId: body.videoId,
      planId: body.eventId ?? null,
      title: body.title,
      speaker: body.speaker || null,
      description: body.description || null,
      imageUrl: body.imageUrl || null,
      startSec: body.startSec,
      endSec: body.endSec,
      fileName,
      status: 'queued',
      createdById: req.user!.id,
    },
  });
  await enqueueJob(tenantId, PODCAST_JOB, podcast.id);
  res.status(201).json(podcast);
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  speaker: z.string().max(190).optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
});

podcastsRouter.patch('/api/podcasts/:id', requirePerm('podcast', 'edit'), async (req, res) => {
  const body = updateSchema.parse(req.body);
  const tenantId = tid(req);
  const podcast = await prisma.podcast.findFirst({ where: { id: String(req.params.id), tenantId } });
  if (!podcast) throw notFound('Podcast');
  const updated = await prisma.podcast.update({
    where: { id: podcast.id },
    data: { ...body, publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined },
  });
  await syncFeed(tenantId);
  res.json(updated);
});

podcastsRouter.post('/api/podcasts/:id/retry', requirePerm('podcast', 'create'), async (req, res) => {
  const tenantId = tid(req);
  const podcast = await prisma.podcast.findFirst({ where: { id: String(req.params.id), tenantId } });
  if (!podcast) throw notFound('Podcast');
  if (podcast.status !== 'failed') throw new HttpError(400, 'Nur fehlgeschlagene Podcasts können neu gestartet werden');
  await prisma.podcast.update({ where: { id: podcast.id }, data: { status: 'queued', error: null, progress: 0 } });
  await enqueueJob(tenantId, PODCAST_JOB, podcast.id);
  res.json({ ok: true });
});

podcastsRouter.delete('/api/podcasts/:id', requirePerm('podcast', 'delete'), async (req, res) => {
  const tenantId = tid(req);
  const podcast = await prisma.podcast.findFirst({ where: { id: String(req.params.id), tenantId } });
  if (!podcast) throw notFound('Podcast');
  if (podcast.status === 'processing') throw new HttpError(400, 'Der Podcast wird gerade verarbeitet – bitte warten');
  let warning: string | undefined;
  if (podcast.status === 'published' && podcast.fileName) {
    const host = await podcastHostFor(tenantId);
    try {
      await host?.provider.deleteFile(host.config, host.secrets, podcast.fileName);
    } catch (err) {
      warning = `Datei konnte auf dem Server nicht gelöscht werden: ${err instanceof Error ? err.message : err}`;
    }
  }
  await prisma.job.deleteMany({ where: { refId: podcast.id, status: { in: ['queued', 'failed'] } } });
  await prisma.podcast.delete({ where: { id: podcast.id } });
  await syncFeed(tenantId);
  res.json({ ok: true, warning });
});
