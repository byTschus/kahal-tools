import { Router } from 'express';
import { prisma } from '../db.js';
import { notFound } from '../lib/http.js';
import { buildFeed } from '../services/podcasts.js';

/** Öffentlicher Podcast-Feed: /feeds/<gemeinde>/podcast.xml */
export const feedsRouter = Router();

feedsRouter.get('/feeds/:slug/podcast.xml', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { slug: String(req.params.slug) } });
  if (!tenant) throw notFound('Feed');
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(await buildFeed(tenant));
});
