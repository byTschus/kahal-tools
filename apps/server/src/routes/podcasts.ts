import express, { Router } from 'express';
import { rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { requirePerm, tid } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError, notFound } from '../lib/http.js';
import { render } from '../lib/template.js';
import { existingGuids, fetchFeed } from '../services/feedImport.js';
import { podcastHostFor, requirePodcastHost, requireStreaming } from '../services/integrations.js';
import { enqueueJob } from '../services/jobs.js';
import { assertPlanFree } from '../services/planLinks.js';
import { planningClientFor } from '../services/planning.js';
import { fileBaseOf, nextFileBase, PODCAST_JOB, PODCAST_PDF_JOB, pdfUploadPath, syncFeed } from '../services/podcasts.js';
import { getSettings, saveSettings } from '../settings.js';

export const podcastsRouter = Router();

const findPodcast = async (tenantId: string, id: string) => {
  const podcast = await prisma.podcast.findFirst({ where: { id, tenantId } });
  if (!podcast) throw notFound('Podcast');
  return podcast;
};

podcastsRouter.get('/api/podcasts', requirePerm('podcast', 'view'), async (req, res) => {
  const podcasts = await prisma.podcast.findMany({
    where: { tenantId: tid(req) },
    orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: 1000,
  });
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
  const linked = eventId ? await prisma.podcast.findFirst({ where: { tenantId, planId: eventId }, select: { title: true } }) : null;
  res.json({
    eventId,
    event: event ? { id: event.id, title: event.title, startsAt: event.startsAt } : null,
    eventLinkedTo: linked?.title ?? null,
    video: { ...broadcast, durationSec: stats[body.videoId]?.durationSec ?? null },
    title: render(settings.titleTemplate, vars, opts).trim() || broadcast.title,
    speaker: render(settings.speakerTemplate, vars, opts).trim(),
    scripture: render(settings.scriptureTemplate, vars, opts).trim(),
    description: render(settings.descriptionTemplate, vars, opts).trim(),
    imageUrl: render(settings.imageTemplate, vars, opts).trim() || settings.feed.imageUrl,
  });
});

const createSchema = z
  .object({
    videoId: z.string(),
    eventId: z.string({ message: 'Bitte einen Plan auswählen' }).min(1, 'Bitte einen Plan auswählen'),
    eventTitle: z.string().nullable().optional(),
    title: z.string().trim().min(1, 'Titel fehlt').max(255),
    speaker: z.string().max(190).default(''),
    scripture: z.string().max(190).default(''),
    description: z.string().default(''),
    imageUrl: z.string().default(''),
    startSec: z.number().int().min(0),
    endSec: z.number().int().positive(),
  })
  .refine((v) => v.endSec - v.startSec >= 10, { message: 'Der Ausschnitt muss mindestens 10 Sekunden lang sein' });

podcastsRouter.post('/api/podcasts', requirePerm('podcast', 'create'), async (req, res) => {
  const body = createSchema.parse(req.body);
  const tenantId = tid(req);
  await requirePodcastHost(tenantId);
  await assertPlanFree('podcast', tenantId, body.eventId);
  const { provider } = await requireStreaming(tenantId);
  const podcast = await prisma.podcast.create({
    data: {
      tenantId,
      sourceProvider: provider.key,
      sourceVideoId: body.videoId,
      planId: body.eventId,
      planTitle: body.eventTitle ?? null,
      title: body.title,
      speaker: body.speaker || null,
      scripture: body.scripture || null,
      description: body.description || null,
      imageUrl: body.imageUrl || null,
      startSec: body.startSec,
      endSec: body.endSec,
      fileName: `${await nextFileBase(tenantId)}.mp3`,
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
  scripture: z.string().max(190).optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  /** Plan verknüpfen (null = Verknüpfung lösen) */
  eventId: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
});

podcastsRouter.patch('/api/podcasts/:id', requirePerm('podcast', 'edit'), async (req, res) => {
  const { eventId, eventTitle, ...body } = updateSchema.parse(req.body);
  const tenantId = tid(req);
  const podcast = await findPodcast(tenantId, String(req.params.id));
  if (eventId) await assertPlanFree('podcast', tenantId, eventId, podcast.id);
  const updated = await prisma.podcast.update({
    where: { id: podcast.id },
    data: {
      ...body,
      speaker: body.speaker === undefined ? undefined : body.speaker || null,
      scripture: body.scripture === undefined ? undefined : body.scripture || null,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
      ...(eventId !== undefined ? { planId: eventId, planTitle: eventId ? (eventTitle ?? null) : null } : {}),
    },
  });
  await syncFeed(tenantId);
  res.json(updated);
});

podcastsRouter.post('/api/podcasts/:id/retry', requirePerm('podcast', 'create'), async (req, res) => {
  const tenantId = tid(req);
  const podcast = await findPodcast(tenantId, String(req.params.id));
  if (podcast.status !== 'failed') throw new HttpError(400, 'Nur fehlgeschlagene Podcasts können neu gestartet werden');
  await prisma.podcast.update({ where: { id: podcast.id }, data: { status: 'queued', error: null, progress: 0 } });
  await enqueueJob(tenantId, PODCAST_JOB, podcast.id);
  res.json({ ok: true });
});

/** Löscht eine Datei auf dem Hosting; Fehler werden als Warnung zurückgegeben */
async function deleteHostFile(tenantId: string, fileName: string | null) {
  if (!fileName) return undefined;
  const host = await podcastHostFor(tenantId);
  try {
    await host?.provider.deleteFile(host.config, host.secrets, fileName);
    return undefined;
  } catch (err) {
    return `${fileName} konnte auf dem Server nicht gelöscht werden: ${err instanceof Error ? err.message : err}`;
  }
}

podcastsRouter.delete('/api/podcasts/:id', requirePerm('podcast', 'delete'), async (req, res) => {
  const tenantId = tid(req);
  const podcast = await findPodcast(tenantId, String(req.params.id));
  if (podcast.status === 'processing') throw new HttpError(400, 'Der Podcast wird gerade verarbeitet – bitte warten');
  const warnings: string[] = [];
  // Importierte Episoden: die Audiodatei liegt beim bisherigen Anbieter und bleibt unangetastet
  if (podcast.status === 'published' && !podcast.imported) {
    const w = await deleteHostFile(tenantId, podcast.fileName);
    if (w) warnings.push(w);
  }
  if (podcast.pdfStatus === 'uploaded') {
    const w = await deleteHostFile(tenantId, podcast.pdfFileName);
    if (w) warnings.push(w);
  }
  await rm(await pdfUploadPath(podcast.id), { force: true });
  await prisma.job.deleteMany({ where: { refId: podcast.id, status: { in: ['queued', 'failed'] } } });
  await prisma.podcast.delete({ where: { id: podcast.id } });
  await syncFeed(tenantId);
  res.json({ ok: true, warning: warnings.join('\n') || undefined });
});

// ----- PDF -----

const MAX_PDF_MB = 30;

podcastsRouter.put(
  '/api/podcasts/:id/pdf',
  requirePerm('podcast', 'edit'),
  express.raw({ type: 'application/pdf', limit: `${MAX_PDF_MB}mb` }),
  async (req, res) => {
    const tenantId = tid(req);
    await requirePodcastHost(tenantId);
    const podcast = await findPodcast(tenantId, String(req.params.id));
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, `Bitte eine PDF-Datei (max. ${MAX_PDF_MB} MB) hochladen`);
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Die Datei ist kein PDF');
    await writeFile(await pdfUploadPath(podcast.id), data);
    const updated = await prisma.podcast.update({
      where: { id: podcast.id },
      data: { pdfFileName: `${await fileBaseOf(podcast)}.pdf`, pdfStatus: 'pending' },
    });
    await prisma.job.deleteMany({ where: { refId: podcast.id, type: PODCAST_PDF_JOB, status: { in: ['queued', 'failed'] } } });
    await enqueueJob(tenantId, PODCAST_PDF_JOB, podcast.id);
    res.json(updated);
  },
);

podcastsRouter.delete('/api/podcasts/:id/pdf', requirePerm('podcast', 'edit'), async (req, res) => {
  const tenantId = tid(req);
  const podcast = await findPodcast(tenantId, String(req.params.id));
  const warning = podcast.pdfStatus === 'uploaded' ? await deleteHostFile(tenantId, podcast.pdfFileName) : undefined;
  await rm(await pdfUploadPath(podcast.id), { force: true });
  await prisma.job.deleteMany({ where: { refId: podcast.id, type: PODCAST_PDF_JOB, status: { in: ['queued', 'failed'] } } });
  const updated = await prisma.podcast.update({ where: { id: podcast.id }, data: { pdfFileName: null, pdfUrl: null, pdfStatus: null } });
  await syncFeed(tenantId);
  res.json({ ...updated, warning });
});

// ----- Import eines bestehenden RSS-Feeds -----

const importSchema = z.object({
  url: z.string().trim().min(1, 'Adresse fehlt'),
  /** false = nur Vorschau */
  commit: z.boolean().default(false),
  /** Leere Feed-Angaben in den Einstellungen mit den Angaben des importierten Feeds füllen */
  adoptChannel: z.boolean().default(false),
});

podcastsRouter.post('/api/podcasts/import-feed', requirePerm('podcast', 'create'), async (req, res) => {
  const body = importSchema.parse(req.body);
  const tenantId = tid(req);
  const feed = await fetchFeed(body.url);
  const existing = await existingGuids(tenantId, feed.episodes.map((e) => e.guid));
  const isNew = (e: (typeof feed.episodes)[number]) => !existing.guids.has(e.guid) && !existing.audioUrls.has(e.audioUrl);
  const fresh = feed.episodes.filter(isNew);

  if (!body.commit) {
    res.json({
      channel: feed.channel,
      total: feed.episodes.length,
      new: fresh.length,
      episodes: feed.episodes.slice(0, 200).map((e) => ({ title: e.title, publishedAt: e.publishedAt, durationSec: e.durationSec, isNew: isNew(e) })),
    });
    return;
  }

  await prisma.podcast.createMany({
    data: fresh.map((e) => ({
      tenantId,
      title: e.title,
      speaker: e.speaker,
      description: e.description,
      imageUrl: e.imageUrl,
      linkUrl: e.linkUrl,
      audioUrl: e.audioUrl,
      fileSize: e.fileSize,
      durationSec: e.durationSec,
      status: 'published',
      progress: 100,
      publishedAt: e.publishedAt ? new Date(e.publishedAt) : new Date(),
      imported: true,
      externalGuid: e.guid,
      createdById: req.user!.id,
    })),
    skipDuplicates: true,
  });

  if (body.adoptChannel) {
    const settings = await getSettings(tenantId, 'podcast');
    const c = feed.channel;
    const fill = (current: string, value: string) => current || value;
    await saveSettings(tenantId, 'podcast', {
      ...settings,
      feed: {
        ...settings.feed,
        title: fill(settings.feed.title, c.title),
        description: fill(settings.feed.description, c.description),
        author: fill(settings.feed.author, c.author),
        email: fill(settings.feed.email, c.email),
        imageUrl: fill(settings.feed.imageUrl, c.imageUrl),
        websiteUrl: fill(settings.feed.websiteUrl, c.websiteUrl),
      },
    });
  }
  await syncFeed(tenantId);
  res.json({ imported: fresh.length, skipped: feed.episodes.length - fresh.length });
});
