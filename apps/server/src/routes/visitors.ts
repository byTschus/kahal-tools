import { Router, type Request } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { requirePerm, tid } from '../auth/middleware.js';
import { prisma } from '../db.js';
import { notFound } from '../lib/http.js';
import { formatDate } from '../lib/template.js';
import { streamingFor } from '../services/integrations.js';
import { getSettings } from '../settings.js';

export const visitorsRouter = Router();

// ----- Orte -----

visitorsRouter.get('/api/visitors/locations', requirePerm('visitors', 'view'), async (req, res) => {
  res.json(await prisma.visitorLocation.findMany({ where: { tenantId: tid(req) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }));
});

const locationSchema = z.object({ name: z.string().trim().min(1).max(100), sortOrder: z.number().int().optional(), active: z.boolean().optional() });

visitorsRouter.post('/api/visitors/locations', requirePerm('visitors', 'settings'), async (req, res) => {
  const body = locationSchema.parse(req.body);
  const tenantId = tid(req);
  const max = await prisma.visitorLocation.aggregate({ where: { tenantId }, _max: { sortOrder: true } });
  res.status(201).json(
    await prisma.visitorLocation.create({ data: { tenantId, name: body.name, sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } }),
  );
});

visitorsRouter.patch('/api/visitors/locations/:id', requirePerm('visitors', 'settings'), async (req, res) => {
  const body = locationSchema.partial().parse(req.body);
  const loc = await prisma.visitorLocation.findFirst({ where: { id: String(req.params.id), tenantId: tid(req) } });
  if (!loc) throw notFound('Ort');
  res.json(await prisma.visitorLocation.update({ where: { id: loc.id }, data: body }));
});

/** Orte mit erfassten Werten werden nur deaktiviert, damit die Statistik erhalten bleibt */
visitorsRouter.delete('/api/visitors/locations/:id', requirePerm('visitors', 'settings'), async (req, res) => {
  const loc = await prisma.visitorLocation.findFirst({ where: { id: String(req.params.id), tenantId: tid(req) }, include: { _count: { select: { values: true } } } });
  if (!loc) throw notFound('Ort');
  if (loc._count.values > 0) {
    await prisma.visitorLocation.update({ where: { id: loc.id }, data: { active: false } });
    res.json({ ok: true, deactivated: true });
  } else {
    await prisma.visitorLocation.delete({ where: { id: loc.id } });
    res.json({ ok: true, deactivated: false });
  }
});

// ----- Livestream-Zahlen -----

visitorsRouter.get('/api/visitors/broadcasts', requirePerm('visitors', 'create'), async (req, res) => {
  const streaming = await streamingFor(tid(req));
  if (!streaming) {
    res.json([]);
    return;
  }
  const [completed, active] = await Promise.all([streaming.client.listBroadcasts('completed'), streaming.client.listBroadcasts('active')]);
  res.json([...active.items, ...completed.items].map((b) => ({ id: b.id, title: b.title, date: b.actualStart ?? b.scheduledStart })));
});

const lsSchema = z.object({ eventId: z.string().nullable().optional(), videoId: z.string().nullable().optional() });

visitorsRouter.post('/api/visitors/livestream-count', requirePerm('visitors', 'create'), async (req, res) => {
  const body = lsSchema.parse(req.body);
  const tenantId = tid(req);
  const settings = await getSettings(tenantId, 'visitors');
  const streaming = await streamingFor(tenantId);
  if (!streaming) {
    res.json({ found: false, message: 'Keine Streaming-Plattform verbunden' });
    return;
  }
  const local = body.videoId
    ? await prisma.livestream.findFirst({ where: { tenantId, externalId: body.videoId } })
    : body.eventId
      ? await prisma.livestream.findFirst({ where: { tenantId, planId: body.eventId }, orderBy: { scheduledStart: 'desc' } })
      : null;
  const videoId = body.videoId ?? local?.externalId;
  if (!videoId) {
    res.json({ found: false, message: 'Zu diesem Event wurde kein Livestream gefunden – bitte manuell auswählen' });
    return;
  }
  const stats = (await streaming.client.getStats([videoId]))[videoId];
  let count: number | null;
  let message: string | undefined;
  if (settings.livestreamMode === 'concurrent') {
    count = Math.max(local?.peakConcurrent ?? 0, stats?.concurrentViewers ?? 0) || null;
    if (count === null) message = 'Spitzenwert gleichzeitiger Zuschauer nicht verfügbar (wird nur während des Streams aufgezeichnet)';
  } else {
    count = stats?.viewCount ?? null;
  }
  if (local && stats) await prisma.livestream.update({ where: { id: local.id }, data: { viewCount: stats.viewCount ?? local.viewCount } });
  res.json({ found: true, videoId, title: local?.title, mode: settings.livestreamMode, count, message });
});

// ----- Erfassungen -----

function dateRange(req: Request) {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 365 * 86400_000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 86400_000);
  return { gte: from, lte: to };
}

async function loadCounts(tenantId: string, req: Request) {
  return prisma.visitorCount.findMany({
    where: { tenantId, eventDate: dateRange(req) },
    include: { values: true },
    orderBy: { eventDate: 'desc' },
  });
}

visitorsRouter.get('/api/visitors/counts', requirePerm('visitors', 'view'), async (req, res) => {
  res.json(await loadCounts(tid(req), req));
});

const countSchema = z.object({
  eventId: z.string().nullable().optional(),
  eventTitle: z.string().trim().min(1).max(190),
  eventDate: z.string().datetime({ offset: true }),
  values: z.array(z.object({ locationId: z.string(), value: z.number().int().min(0) })).default([]),
  livestreamEnabled: z.boolean().default(false),
  livestreamMode: z.enum(['concurrent', 'views']).nullable().optional(),
  livestreamVideoId: z.string().nullable().optional(),
  livestreamCount: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

async function validLocationValues(tenantId: string, values: { locationId: string; value: number }[]) {
  const ids = new Set((await prisma.visitorLocation.findMany({ where: { tenantId }, select: { id: true } })).map((l) => l.id));
  return values.filter((v) => ids.has(v.locationId));
}

visitorsRouter.post('/api/visitors/counts', requirePerm('visitors', 'create'), async (req, res) => {
  const body = countSchema.parse(req.body);
  const tenantId = tid(req);
  const values = await validLocationValues(tenantId, body.values);
  const count = await prisma.visitorCount.create({
    data: {
      tenantId,
      planId: body.eventId ?? null,
      eventTitle: body.eventTitle,
      eventDate: new Date(body.eventDate),
      livestreamEnabled: body.livestreamEnabled,
      livestreamMode: body.livestreamEnabled ? (body.livestreamMode ?? null) : null,
      livestreamVideoId: body.livestreamEnabled ? (body.livestreamVideoId ?? null) : null,
      livestreamCount: body.livestreamEnabled ? (body.livestreamCount ?? null) : null,
      notes: body.notes ?? null,
      createdById: req.user!.id,
      values: { create: values },
    },
    include: { values: true },
  });
  res.status(201).json(count);
});

visitorsRouter.patch('/api/visitors/counts/:id', requirePerm('visitors', 'edit'), async (req, res) => {
  const body = countSchema.partial().parse(req.body);
  const tenantId = tid(req);
  const existing = await prisma.visitorCount.findFirst({ where: { id: String(req.params.id), tenantId } });
  if (!existing) throw notFound('Erfassung');
  if (body.values) {
    const values = await validLocationValues(tenantId, body.values);
    await prisma.visitorCountValue.deleteMany({ where: { countId: existing.id } });
    await prisma.visitorCountValue.createMany({ data: values.map((v) => ({ ...v, countId: existing.id })) });
  }
  const updated = await prisma.visitorCount.update({
    where: { id: existing.id },
    data: {
      planId: body.eventId,
      eventTitle: body.eventTitle,
      eventDate: body.eventDate ? new Date(body.eventDate) : undefined,
      livestreamEnabled: body.livestreamEnabled,
      livestreamMode: body.livestreamMode,
      livestreamVideoId: body.livestreamVideoId,
      livestreamCount: body.livestreamCount,
      notes: body.notes,
    },
    include: { values: true },
  });
  res.json(updated);
});

visitorsRouter.delete('/api/visitors/counts/:id', requirePerm('visitors', 'delete'), async (req, res) => {
  const { count } = await prisma.visitorCount.deleteMany({ where: { id: String(req.params.id), tenantId: tid(req) } });
  if (!count) throw notFound('Erfassung');
  res.json({ ok: true });
});

// ----- Statistik & Export -----

type CountRow = Awaited<ReturnType<typeof loadCounts>>[number];

function rowTotals(c: CountRow) {
  const onSite = c.values.reduce((s, v) => s + v.value, 0);
  const livestream = c.livestreamEnabled ? (c.livestreamCount ?? 0) : 0;
  return { onSite, livestream, total: onSite + livestream };
}

const avg = (sum: number, n: number) => (n ? Math.round((sum / n) * 10) / 10 : 0);

export function computeStats(counts: CountRow[], locations: { id: string; name: string; active: boolean }[], timeZone: string) {
  const events = counts.map((c) => ({
    id: c.id,
    date: c.eventDate,
    title: c.eventTitle,
    ...rowTotals(c),
    values: Object.fromEntries(c.values.map((v) => [v.locationId, v.value])),
  }));
  const n = events.length;
  const sum = (key: 'onSite' | 'livestream' | 'total') => events.reduce((s, e) => s + e[key], 0);
  const withLivestream = counts.filter((c) => c.livestreamEnabled && c.livestreamCount != null).length;

  const perLocation = locations.map((loc) => {
    const vals = counts.flatMap((c) => c.values.filter((v) => v.locationId === loc.id).map((v) => v.value));
    const total = vals.reduce((s, v) => s + v, 0);
    return { id: loc.id, name: loc.name, active: loc.active, sum: total, avg: avg(total, vals.length), max: vals.length ? Math.max(...vals) : 0, entries: vals.length };
  });

  const months = new Map<string, { month: string; events: number; onSite: number; livestream: number; total: number }>();
  for (const e of events) {
    const key = formatDate(e.date, 'yyyy-MM', timeZone);
    const m = months.get(key) ?? { month: key, events: 0, onSite: 0, livestream: 0, total: 0 };
    m.events++;
    m.onSite += e.onSite;
    m.livestream += e.livestream;
    m.total += e.total;
    months.set(key, m);
  }
  const perMonth = [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, avgOnSite: avg(m.onSite, m.events), avgTotal: avg(m.total, m.events) }));

  const max = events.reduce<(typeof events)[number] | null>((best, e) => (!best || e.total > best.total ? e : best), null);
  return {
    summary: {
      events: n,
      onSite: sum('onSite'),
      livestream: sum('livestream'),
      total: sum('total'),
      avgOnSite: avg(sum('onSite'), n),
      avgLivestream: avg(sum('livestream'), withLivestream),
      avgTotal: avg(sum('total'), n),
      maxEvent: max ? { title: max.title, date: max.date, total: max.total } : null,
    },
    perLocation,
    perMonth,
    events: [...events].sort((a, b) => a.date.getTime() - b.date.getTime()),
  };
}

visitorsRouter.get('/api/visitors/stats', requirePerm('visitors', 'view'), async (req, res) => {
  const tenantId = tid(req);
  const [counts, locations] = await Promise.all([loadCounts(tenantId, req), prisma.visitorLocation.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } })]);
  res.json(computeStats(counts, locations, req.user!.tenant.timeZone));
});

visitorsRouter.get('/api/visitors/export.xlsx', requirePerm('visitors', 'view'), async (req, res) => {
  const tenantId = tid(req);
  const tz = req.user!.tenant.timeZone;
  const [counts, locations] = await Promise.all([loadCounts(tenantId, req), prisma.visitorLocation.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } })]);
  const stats = computeStats(counts, locations, tz);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'kahal.tools';
  const header = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const ws = wb.addWorksheet('Erfassungen');
  ws.columns = [
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Zeit', key: 'time', width: 8 },
    { header: 'Event', key: 'title', width: 36 },
    ...locations.map((l) => ({ header: l.name, key: `loc_${l.id}`, width: 14 })),
    { header: 'Vor Ort', key: 'onSite', width: 10 },
    { header: 'Livestream', key: 'livestream', width: 12 },
    { header: 'Total', key: 'total', width: 10 },
    { header: 'Notizen', key: 'notes', width: 40 },
  ];
  for (const c of [...counts].reverse()) {
    const t = rowTotals(c);
    ws.addRow({
      date: formatDate(c.eventDate, 'dd.MM.yyyy', tz),
      time: formatDate(c.eventDate, 'HH:mm', tz),
      title: c.eventTitle,
      ...Object.fromEntries(c.values.map((v) => [`loc_${v.locationId}`, v.value])),
      onSite: t.onSite,
      livestream: c.livestreamEnabled ? c.livestreamCount : null,
      total: t.total,
      notes: c.notes ?? '',
    });
  }
  header(ws);

  const wm = wb.addWorksheet('Monate');
  wm.columns = [
    { header: 'Monat', key: 'month', width: 10 },
    { header: 'Events', key: 'events', width: 8 },
    { header: 'Vor Ort', key: 'onSite', width: 10 },
    { header: 'Livestream', key: 'livestream', width: 12 },
    { header: 'Total', key: 'total', width: 10 },
    { header: 'Ø Vor Ort', key: 'avgOnSite', width: 10 },
    { header: 'Ø Total', key: 'avgTotal', width: 10 },
  ];
  stats.perMonth.forEach((m) => wm.addRow(m));
  header(wm);

  const wl = wb.addWorksheet('Orte');
  wl.columns = [
    { header: 'Ort', key: 'name', width: 24 },
    { header: 'Summe', key: 'sum', width: 10 },
    { header: 'Durchschnitt', key: 'avg', width: 12 },
    { header: 'Maximum', key: 'max', width: 10 },
    { header: 'Erfassungen', key: 'entries', width: 12 },
  ];
  stats.perLocation.forEach((l) => wl.addRow(l));
  header(wl);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="besucher-${formatDate(new Date(), 'yyyy-MM-dd', tz)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});
