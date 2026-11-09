import { Router } from 'express';
import { z } from 'zod';
import { requirePerm, tid } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { HttpError, notFound } from '../lib/http.js';
import { render } from '../lib/template.js';
import { existingGuids, fetchFeed } from '../services/feedImport.js';
import { podcastHostFor, requirePodcastHost, requireStreaming } from '../services/integrations.js';
import { enqueueJob } from '../services/jobs.js';
import { assertPlanFree } from '../services/planLinks.js';
import { matchPlans } from '../services/planMatch.js';
import { planningClientFor } from '../services/planning.js';
import { nextFileBase, PODCAST_JOB, syncFeed } from '../services/podcasts.js';
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
  // Episoden aus einem Livestream mit Plan: der Plan kommt vom Livestream und ist fix
  const streams = await prisma.livestream.findMany({
    where: { tenantId: tid(req), planId: { not: null }, externalId: { in: podcasts.flatMap((p) => (p.sourceVideoId ? [p.sourceVideoId] : [])) } },
    select: { provider: true, externalId: true },
  });
  const locked = new Set(streams.map((s) => `${s.provider}:${s.externalId}`));
  res.json(podcasts.map((p) => ({ ...p, planLocked: locked.has(`${p.sourceProvider}:${p.sourceVideoId}`) })));
});

/** Plan des Livestreams, aus dem eine Episode geschnitten wird (Livestreams aus kahal.tools haben immer einen) */
async function streamPlan(tenantId: string, provider: string | null, videoId: string | null) {
  if (!provider || !videoId) return null;
  const stream = await prisma.livestream.findFirst({ where: { tenantId, provider, externalId: videoId }, select: { planId: true, planTitle: true } });
  return stream?.planId ? { planId: stream.planId, planTitle: stream.planTitle } : null;
}

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
  // Hat der Livestream einen Plan, gilt dieser fest für den Podcast
  const planLocked = Boolean(local?.planId);
  const eventId = local?.planId ?? body.eventId ?? null;
  const event = eventId ? await (await planningClientFor(req.user!)).getEvent(eventId) : null;
  const vars = {
    ...(event?.variables ?? { event: { title: broadcast.title, date: broadcast.actualStart ?? broadcast.scheduledStart } }),
    video: { title: broadcast.title, description: broadcast.description, date: broadcast.actualStart ?? broadcast.scheduledStart },
    freitext: body.freitext ?? '',
  };
  const opts = { timeZone: req.user!.tenant.timeZone };
  const planImageUrl = render(settings.imageTemplate, vars, opts).trim();
  const linked = eventId ? await prisma.podcast.findFirst({ where: { tenantId, planId: eventId }, select: { title: true } }) : null;
  res.json({
    eventId,
    event: event ? { id: event.id, title: event.title, startsAt: event.startsAt } : null,
    eventLinkedTo: linked?.title ?? null,
    /** Plan stammt vom Livestream und kann nicht geändert werden */
    planLocked,
    video: { ...broadcast, durationSec: stats[body.videoId]?.durationSec ?? null },
    title: render(settings.titleTemplate, vars, opts).trim() || broadcast.title,
    speaker: render(settings.speakerTemplate, vars, opts).trim(),
    scripture: render(settings.scriptureTemplate, vars, opts).trim(),
    description: render(settings.descriptionTemplate, vars, opts).trim(),
    /** Zur Auswahl beim Erstellen: Bild aus dem Plan (Vorlage) oder Bild des Podcast-Kanals */
    planImageUrl,
    channelImageUrl: settings.feed.imageUrl,
    defaultImage: settings.defaultImage,
    // Vorauswahl gemäss Einstellung, sonst das andere Bild
    imageUrl: (settings.defaultImage === 'channel' ? settings.feed.imageUrl || planImageUrl : planImageUrl || settings.feed.imageUrl) ?? '',
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
  const { provider } = await requireStreaming(tenantId);
  // Der Plan des Livestreams hat Vorrang vor dem mitgeschickten
  const fixed = await streamPlan(tenantId, provider.key, body.videoId);
  if (fixed) {
    body.eventId = fixed.planId;
    body.eventTitle = fixed.planTitle ?? body.eventTitle;
  }
  await assertPlanFree('podcast', tenantId, body.eventId);
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
  if (eventId !== undefined && eventId !== podcast.planId && (await streamPlan(tenantId, podcast.sourceProvider, podcast.sourceVideoId))) {
    throw new HttpError(400, 'Der Plan kommt vom Livestream dieser Episode und kann nicht geändert werden');
  }
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
  // Importierte Episoden: die Audiodatei liegt beim bisherigen Anbieter und bleibt unangetastet
  const warning = podcast.status === 'published' && !podcast.imported ? await deleteHostFile(tenantId, podcast.fileName) : undefined;
  await prisma.job.deleteMany({ where: { refId: podcast.id, status: { in: ['queued', 'failed'] } } });
  await prisma.podcast.delete({ where: { id: podcast.id } });
  await syncFeed(tenantId);
  res.json({ ok: true, warning });
});

// ----- Import eines bestehenden RSS-Feeds -----

const importSchema = z.object({
  url: z.string().trim().min(1, 'Adresse fehlt'),
  /** false = nur Vorschau */
  commit: z.boolean().default(false),
  /** Leere Feed-Angaben in den Einstellungen mit den Angaben des importierten Feeds füllen */
  adoptChannel: z.boolean().default(false),
  /** Neue Episoden automatisch einem Plan zuordnen (Datum, Titel) */
  matchPlans: z.boolean().default(false),
});

podcastsRouter.post('/api/podcasts/import-feed', requirePerm('podcast', 'create'), async (req, res) => {
  const body = importSchema.parse(req.body);
  const tenantId = tid(req);
  const feed = await fetchFeed(body.url);
  const existing = await existingGuids(tenantId, feed.episodes.map((e) => e.guid));
  const isNew = (e: (typeof feed.episodes)[number]) => !existing.guids.has(e.guid) && !existing.audioUrls.has(e.audioUrl);
  const fresh = feed.episodes.filter(isNew);
  const match = body.matchPlans
    ? await matchPlans(
        req.user!,
        'podcast',
        fresh.filter((e) => e.publishedAt).map((e) => ({ key: e.guid, date: new Date(e.publishedAt!), hasTime: false, title: e.title })),
      )
    : null;

  if (!body.commit) {
    res.json({
      channel: feed.channel,
      total: feed.episodes.length,
      new: fresh.length,
      matching: match ? { error: match.error, linked: match.matches.size, ambiguous: match.ambiguous.size } : undefined,
      episodes: feed.episodes.slice(0, 200).map((e) => ({
        title: e.title,
        publishedAt: e.publishedAt,
        durationSec: e.durationSec,
        isNew: isNew(e),
        plan: match?.matches.get(e.guid) ?? null,
        ambiguous: match?.ambiguous.has(e.guid) ?? false,
      })),
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
      planId: match?.matches.get(e.guid)?.planId ?? null,
      planTitle: match?.matches.get(e.guid)?.title ?? null,
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
  res.json({ imported: fresh.length, skipped: feed.episodes.length - fresh.length, linked: match?.matches.size ?? 0, matchError: match?.error });
});
