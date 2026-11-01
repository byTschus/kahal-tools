import type { Podcast, Tenant } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { getStreamingProvider } from '../providers/streaming/index.js';
import { getSettings } from '../settings.js';
import { podcastHostFor, requirePodcastHost } from './integrations.js';
import { registerJobHandler } from './jobs.js';

export const PODCAST_JOB = 'podcast.render';

registerJobHandler(PODCAST_JOB, {
  async buildPayload(job) {
    const podcast = await prisma.podcast.findUniqueOrThrow({ where: { id: job.refId! } });
    const host = await requirePodcastHost(job.tenantId);
    const settings = await getSettings(job.tenantId, 'podcast');
    return {
      podcastId: podcast.id,
      videoUrl: getStreamingProvider(podcast.sourceProvider).videoUrl(podcast.sourceVideoId),
      startSec: podcast.startSec,
      endSec: podcast.endSec,
      fileName: podcast.fileName,
      audio: { bitrate: settings.bitrate, mono: settings.mono, normalize: settings.normalize },
      tags: {
        title: podcast.title,
        artist: podcast.speaker ?? '',
        album: settings.feed.title,
        date: podcast.createdAt.toISOString().slice(0, 10),
        comment: podcast.description ?? '',
      },
      imageUrl: podcast.imageUrl,
      host: { type: host.integration.provider, config: host.config, secrets: host.secrets },
    };
  },

  async onProgress(job, progress, message) {
    await prisma.podcast.updateMany({
      where: { id: job.refId! },
      data: { status: 'processing', progress, error: message && progress === 0 ? null : undefined },
    });
  },

  async onComplete(job, result: { fileSize?: number; durationSec?: number }) {
    const host = await requirePodcastHost(job.tenantId);
    const podcast = await prisma.podcast.findUniqueOrThrow({ where: { id: job.refId! } });
    await prisma.podcast.update({
      where: { id: podcast.id },
      data: {
        status: 'published',
        progress: 100,
        error: null,
        fileSize: result.fileSize ?? null,
        durationSec: result.durationSec ?? podcast.endSec - podcast.startSec,
        audioUrl: host.provider.publicUrl(host.config, podcast.fileName!),
        publishedAt: podcast.publishedAt ?? new Date(),
      },
    });
    await syncFeed(job.tenantId);
  },

  async onFailed(job, error, final) {
    await prisma.podcast.updateMany({
      where: { id: job.refId! },
      data: final ? { status: 'failed', error } : { status: 'queued', error: `${error} – neuer Versuch folgt` },
    });
  },
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function feedUrl(tenant: Pick<Tenant, 'slug'>) {
  return `${config.appUrl}/feeds/${tenant.slug}/podcast.xml`;
}

/** RSS-Feed (Apple/Spotify-kompatibel) aus allen veröffentlichten Episoden */
export async function buildFeed(tenant: Tenant): Promise<string> {
  const settings = await getSettings(tenant.id, 'podcast');
  const feed = settings.feed;
  const episodes: Podcast[] = await prisma.podcast.findMany({
    where: { tenantId: tenant.id, status: 'published' },
    orderBy: { publishedAt: 'desc' },
    take: 500,
  });
  const title = feed.title || tenant.name;
  const items = episodes
    .map(
      (e) => `    <item>
      <title>${esc(e.title)}</title>
      <description>${esc(e.description ?? '')}</description>
      <itunes:summary>${esc(e.description ?? '')}</itunes:summary>
      ${e.speaker ? `<itunes:author>${esc(e.speaker)}</itunes:author>` : ''}
      <enclosure url="${esc(e.audioUrl ?? '')}" length="${e.fileSize ?? 0}" type="audio/mpeg"/>
      <guid isPermaLink="false">${e.id}</guid>
      <pubDate>${(e.publishedAt ?? e.createdAt).toUTCString()}</pubDate>
      <itunes:duration>${duration(e.durationSec ?? e.endSec - e.startSec)}</itunes:duration>
      ${e.imageUrl ? `<itunes:image href="${esc(e.imageUrl)}"/>` : ''}
      <itunes:explicit>${feed.explicit ? 'true' : 'false'}</itunes:explicit>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(feed.websiteUrl || config.appUrl)}</link>
    <atom:link href="${esc(feedUrl(tenant))}" rel="self" type="application/rss+xml"/>
    <description>${esc(feed.description || title)}</description>
    <language>${esc(feed.language)}</language>
    <itunes:author>${esc(feed.author || tenant.name)}</itunes:author>
    <itunes:owner><itunes:name>${esc(feed.author || tenant.name)}</itunes:name><itunes:email>${esc(feed.email)}</itunes:email></itunes:owner>
    ${feed.imageUrl ? `<itunes:image href="${esc(feed.imageUrl)}"/>\n    <image><url>${esc(feed.imageUrl)}</url><title>${esc(title)}</title><link>${esc(feed.websiteUrl || config.appUrl)}</link></image>` : ''}
    <itunes:category text="${esc(feed.category)}"/>
    <itunes:explicit>${feed.explicit ? 'true' : 'false'}</itunes:explicit>
${items}
  </channel>
</rss>
`;
}

/** Lädt den Feed zusätzlich auf das Podcast-Hosting (falls aktiviert). Fehler werden nur geloggt. */
export async function syncFeed(tenantId: string) {
  try {
    const settings = await getSettings(tenantId, 'podcast');
    if (!settings.uploadFeed) return;
    const host = await podcastHostFor(tenantId);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (host) await host.provider.uploadText(host.config, host.secrets, 'feed.xml', await buildFeed(tenant));
  } catch (err) {
    console.warn('Feed-Upload fehlgeschlagen:', err instanceof Error ? err.message : err);
  }
}
