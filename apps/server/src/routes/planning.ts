import { Router } from 'express';
import { z } from 'zod';
import { requireUser, tid } from '../auth/middleware.js';
import { HttpError } from '../lib/http.js';
import { filterNames, listVariables, render } from '../lib/template.js';
import { planningClientFor } from '../services/planning.js';
import { getSettings } from '../settings.js';
import type { Request } from 'express';

export const planningRouter = Router();
planningRouter.use('/api/planning', requireUser);

/** Zeitraum aus Query: range=upcoming|past|all oder from/to (ISO) */
export function eventRange(req: Request) {
  const now = Date.now();
  const day = 86400_000;
  const range = String(req.query.range ?? 'upcoming');
  const from = req.query.from ? new Date(String(req.query.from)) : range === 'upcoming' ? new Date(now - day) : new Date(now - 180 * day);
  const to = req.query.to ? new Date(String(req.query.to)) : range === 'past' ? new Date(now) : new Date(now + 120 * day);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new HttpError(400, 'Ungültiger Zeitraum');
  return { from, to, order: (range === 'past' ? 'desc' : 'asc') as 'asc' | 'desc' };
}

planningRouter.get('/api/planning/sources', async (req, res) => {
  const client = await planningClientFor(req.user!);
  res.json(await client.listEventSources());
});

planningRouter.get('/api/planning/events', async (req, res) => {
  const client = await planningClientFor(req.user!);
  const { sourceIds } = await getSettings(tid(req), 'planning');
  res.json(await client.listEvents({ ...eventRange(req), sourceIds, limit: 100 }));
});

planningRouter.get('/api/planning/events/:id', async (req, res) => {
  const client = await planningClientFor(req.user!);
  res.json(await client.getEvent(String(req.params.id)));
});

/** Alle Variablen eines Plans (für die Template-Hilfe in den Einstellungen) */
planningRouter.get('/api/planning/events/:id/variables', async (req, res) => {
  const client = await planningClientFor(req.user!);
  const event = await client.getEvent(String(req.params.id));
  res.json({
    variables: [...listVariables(event.variables), { path: 'freitext', sample: '(Freitext beim Erstellen)' }],
    filters: filterNames,
    items: event.items,
  });
});

const previewSchema = z.object({
  eventId: z.string(),
  templates: z.record(z.string(), z.string()),
  freitext: z.string().optional(),
});

planningRouter.post('/api/planning/preview', async (req, res) => {
  const body = previewSchema.parse(req.body);
  const client = await planningClientFor(req.user!);
  const event = await client.getEvent(body.eventId);
  const vars = { ...event.variables, freitext: body.freitext ?? '' };
  const out: Record<string, string> = {};
  for (const [key, tpl] of Object.entries(body.templates)) out[key] = render(tpl, vars, { timeZone: req.user!.tenant.timeZone });
  res.json(out);
});
