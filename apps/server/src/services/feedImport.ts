import { XMLParser } from 'fast-xml-parser';
import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';

/**
 * Import eines bestehenden Podcast-Feeds (RSS 2.0 / iTunes). Die Episoden werden als veröffentlichte,
 * importierte Podcasts übernommen; die Audiodateien bleiben, wo sie sind (Link aus dem Feed).
 */

export interface FeedEpisode {
  guid: string;
  title: string;
  description: string | null;
  speaker: string | null;
  audioUrl: string;
  fileSize: number | null;
  durationSec: number | null;
  publishedAt: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
}

export interface ParsedFeed {
  channel: { title: string; description: string; author: string; email: string; imageUrl: string; websiteUrl: string; language: string; category: string };
  episodes: FeedEpisode[];
}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
  return String(v).trim();
};

const attr = (v: unknown, name: string): string => {
  const node = Array.isArray(v) ? v[0] : v;
  return node && typeof node === 'object' ? text((node as Record<string, unknown>)[`@_${name}`]) : '';
};

/** itunes:duration: "3725", "62:05" oder "01:02:05" */
function parseDuration(value: string): number | null {
  if (!value) return null;
  const parts = value.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return Math.round(parts.reduce((sum, n) => sum * 60 + n, 0)) || null;
}

const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function parseFeed(xml: string): ParsedFeed {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false, trimValues: true });
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new HttpError(400, 'Die Adresse liefert keinen gültigen RSS-Feed');
  }
  const channel = doc?.rss?.channel;
  if (!channel) throw new HttpError(400, 'Die Adresse liefert keinen RSS-Feed (kein <channel> gefunden)');
  const items: any[] = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

  const episodes: FeedEpisode[] = [];
  for (const item of items) {
    const audioUrl = attr(item.enclosure, 'url');
    if (!audioUrl) continue;
    const date = text(item.pubDate);
    const published = date ? new Date(date) : null;
    episodes.push({
      guid: (text(item.guid) || audioUrl).slice(0, 500),
      title: (text(item.title) || 'Ohne Titel').slice(0, 255),
      description: stripHtml(text(item['content:encoded']) || text(item.description) || text(item['itunes:summary'])) || null,
      speaker: text(item['itunes:author']).slice(0, 190) || null,
      audioUrl,
      fileSize: Number(attr(item.enclosure, 'length')) || null,
      durationSec: parseDuration(text(item['itunes:duration'])),
      publishedAt: published && !isNaN(published.getTime()) ? published.toISOString() : null,
      imageUrl: attr(item['itunes:image'], 'href') || null,
      linkUrl: text(item.link) || null,
    });
  }

  const owner = channel['itunes:owner'] ?? {};
  return {
    channel: {
      title: text(channel.title),
      description: stripHtml(text(channel.description) || text(channel['itunes:summary'])),
      author: text(channel['itunes:author']) || text(owner['itunes:name']),
      email: text(owner['itunes:email']),
      imageUrl: attr(channel['itunes:image'], 'href') || text(channel.image?.url),
      websiteUrl: text(Array.isArray(channel.link) ? channel.link.find((l: unknown) => typeof l === 'string') : channel.link),
      language: text(channel.language),
      category: attr(channel['itunes:category'], 'text'),
    },
    episodes,
  };
}

export async function fetchFeed(url: string): Promise<ParsedFeed> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, 'Ungültige Adresse');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new HttpError(400, 'Nur http- und https-Adressen sind erlaubt');
  let res: Response;
  try {
    res = await fetch(parsed, { headers: { 'User-Agent': 'kahal.tools Feed-Import', Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new HttpError(400, `Feed konnte nicht geladen werden: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new HttpError(400, `Feed konnte nicht geladen werden (HTTP ${res.status})`);
  const xml = await res.text();
  if (xml.length > 20_000_000) throw new HttpError(400, 'Der Feed ist zu gross');
  return parseFeed(xml);
}

/** GUIDs, die bei dieser Gemeinde schon importiert sind */
export async function existingGuids(tenantId: string, guids: string[]) {
  const rows = await prisma.podcast.findMany({ where: { tenantId, externalGuid: { in: guids } }, select: { externalGuid: true } });
  const audio = await prisma.podcast.findMany({ where: { tenantId, audioUrl: { not: null } }, select: { audioUrl: true } });
  return { guids: new Set(rows.map((r) => r.externalGuid!)), audioUrls: new Set(audio.map((a) => a.audioUrl!)) };
}
