import { fetchJson, HttpError } from '../../lib/http.js';
import type { Broadcast, BroadcastInput, BroadcastStatus, OAuthAppCreds, StreamingClient, StreamingProvider, StreamingSecrets, VideoStats } from './types.js';

/**
 * YouTube Data API v3 (https://developers.google.com/youtube/v3/live)
 * Kontingent: 10'000 Einheiten/Tag pro Google-Projekt. list = 1, insert/update = 50.
 */
const API = 'https://www.googleapis.com/youtube/v3';
const SCOPE = 'https://www.googleapis.com/auth/youtube';

export const youtubeProvider: StreamingProvider = {
  key: 'youtube',
  label: 'YouTube',
  getAuthorizeUrl(state, redirectUri, app) {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode(code, redirectUri, app) {
    const body = await fetchJson('https://oauth2.googleapis.com/token', {
      service: 'Google',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000,
      clientId: app.clientId,
    };
  },

  createClient: (secrets, app, onTokens) => new YouTubeClient(secrets, app, onTokens),
  videoUrl: (id) => `https://www.youtube.com/watch?v=${id}`,
};

/** YouTube erlaubt keine spitzen Klammern; Titel max. 100, Beschreibung max. 5000 Zeichen. */
function clean(text: string, max: number) {
  return text.replace(/</g, '‹').replace(/>/g, '›').slice(0, max);
}

function mapStatus(lifeCycle: string | undefined): BroadcastStatus {
  if (lifeCycle === 'live' || lifeCycle === 'liveStarting') return 'live';
  if (lifeCycle === 'complete' || lifeCycle === 'revoked') return 'completed';
  return 'upcoming';
}

function mapBroadcast(b: any): Broadcast {
  const thumbs = b.snippet?.thumbnails ?? {};
  return {
    id: b.id,
    title: b.snippet?.title ?? '',
    description: b.snippet?.description ?? '',
    scheduledStart: b.snippet?.scheduledStartTime ?? null,
    actualStart: b.snippet?.actualStartTime ?? null,
    actualEnd: b.snippet?.actualEndTime ?? null,
    status: mapStatus(b.status?.lifeCycleStatus),
    privacy: b.status?.privacyStatus ?? 'public',
    thumbnailUrl: (thumbs.medium ?? thumbs.high ?? thumbs.default)?.url,
    url: `https://www.youtube.com/watch?v=${b.id}`,
  };
}

/** ISO-8601-Dauer (PT1H2M3S) in Sekunden */
export function parseDuration(iso?: string): number | undefined {
  const m = iso?.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return undefined;
  const [, d, h, min, s] = m.map((v) => Number(v ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

class YouTubeClient implements StreamingClient {
  constructor(
    private secrets: StreamingSecrets,
    private app: OAuthAppCreds | null,
    private onTokens: (s: StreamingSecrets) => Promise<void>,
  ) {}

  private async token(): Promise<string> {
    if (this.secrets.expiresAt && this.secrets.expiresAt > Date.now()) return this.secrets.accessToken;
    if (!this.secrets.refreshToken || !this.app) throw new HttpError(400, 'YouTube-Verbindung abgelaufen – bitte in den Einstellungen neu verbinden', 'reconnect');
    try {
      const body = await fetchJson('https://oauth2.googleapis.com/token', {
        service: 'Google',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: this.secrets.refreshToken,
          client_id: this.app.clientId,
          client_secret: this.app.clientSecret,
          grant_type: 'refresh_token',
        }),
      });
      this.secrets = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? this.secrets.refreshToken,
        expiresAt: Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000,
        clientId: this.app.clientId,
      };
      await this.onTokens(this.secrets);
      return this.secrets.accessToken;
    } catch (err) {
      throw new HttpError(400, 'YouTube-Verbindung ungültig – bitte in den Einstellungen neu verbinden', 'reconnect');
    }
  }

  private async call<T = any>(method: string, path: string, params: Record<string, string> = {}, body?: unknown): Promise<T> {
    const url = `${API}/${path}?${new URLSearchParams(params)}`;
    return fetchJson<T>(url, {
      service: 'YouTube',
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async getAccount() {
    const res = await this.call('GET', 'channels', { part: 'snippet', mine: 'true' });
    const ch = res.items?.[0];
    if (!ch) throw new HttpError(400, 'Mit diesem Google-Konto ist kein YouTube-Kanal verbunden');
    return { id: ch.id, name: ch.snippet.title, avatarUrl: ch.snippet.thumbnails?.default?.url };
  }

  async listStreamKeys() {
    const res = await this.call('GET', 'liveStreams', { part: 'snippet,cdn', mine: 'true', maxResults: '50' });
    return (res.items ?? []).map((s: any) => ({
      id: s.id,
      name: `${s.snippet.title}${s.cdn?.resolution ? ` (${s.cdn.resolution})` : ''}`,
    }));
  }

  async listPlaylists() {
    const res = await this.call('GET', 'playlists', { part: 'snippet', mine: 'true', maxResults: '50' });
    return (res.items ?? []).map((p: any) => ({ id: p.id, name: p.snippet.title }));
  }

  async listBroadcasts(status: 'upcoming' | 'active' | 'completed' | 'all', pageToken?: string) {
    const params: Record<string, string> = {
      part: 'snippet,status,contentDetails',
      broadcastStatus: status,
      broadcastType: 'all',
      maxResults: '50',
    };
    if (pageToken) params.pageToken = pageToken;
    const res = await this.call('GET', 'liveBroadcasts', params);
    return { items: (res.items ?? []).map(mapBroadcast), nextPageToken: res.nextPageToken };
  }

  async getBroadcast(id: string) {
    const res = await this.call('GET', 'liveBroadcasts', { part: 'snippet,status,contentDetails', id });
    return res.items?.[0] ? mapBroadcast(res.items[0]) : null;
  }

  async createBroadcast(input: BroadcastInput) {
    const created = await this.call('POST', 'liveBroadcasts', { part: 'snippet,status,contentDetails' }, {
      snippet: {
        title: clean(input.title, 100),
        description: clean(input.description, 5000),
        scheduledStartTime: input.scheduledStart,
      },
      status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
      contentDetails: {
        enableAutoStart: input.autoStart ?? true,
        enableAutoStop: input.autoStop ?? true,
        enableDvr: true,
      },
    });
    if (input.streamKeyId) {
      await this.call('POST', 'liveBroadcasts/bind', { id: created.id, part: 'id,contentDetails', streamId: input.streamKeyId });
    }
    if (input.playlistId) {
      await this.call('POST', 'playlistItems', { part: 'snippet' }, {
        snippet: { playlistId: input.playlistId, resourceId: { kind: 'youtube#video', videoId: created.id } },
      }).catch((err) => console.warn('Playlist konnte nicht gesetzt werden:', err.message));
    }
    return mapBroadcast(created);
  }

  async updateBroadcast(id: string, input: Partial<BroadcastInput>) {
    const current = await this.getBroadcast(id);
    if (!current) throw new HttpError(404, 'Livestream auf YouTube nicht gefunden');
    const updated = await this.call('PUT', 'liveBroadcasts', { part: 'snippet,status' }, {
      id,
      snippet: {
        title: clean(input.title ?? current.title, 100),
        description: clean(input.description ?? current.description, 5000),
        scheduledStartTime: input.scheduledStart ?? current.scheduledStart,
      },
      status: { privacyStatus: input.privacy ?? current.privacy },
    });
    if (input.streamKeyId) {
      await this.call('POST', 'liveBroadcasts/bind', { id, part: 'id,contentDetails', streamId: input.streamKeyId });
    }
    return mapBroadcast(updated);
  }

  async deleteBroadcast(id: string) {
    const res = await fetch(`${API}/liveBroadcasts?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await this.token()}` },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      throw new HttpError(502, `YouTube: ${body?.error?.message ?? res.statusText}`);
    }
  }

  async getStats(ids: string[]) {
    const out: Record<string, VideoStats> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const res = await this.call('GET', 'videos', {
        part: 'statistics,liveStreamingDetails,contentDetails,snippet',
        id: ids.slice(i, i + 50).join(','),
      });
      for (const v of res.items ?? []) {
        const live = v.snippet?.liveBroadcastContent;
        out[v.id] = {
          concurrentViewers: v.liveStreamingDetails?.concurrentViewers ? Number(v.liveStreamingDetails.concurrentViewers) : undefined,
          viewCount: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
          status: live === 'live' ? 'live' : live === 'upcoming' ? 'upcoming' : 'completed',
          durationSec: parseDuration(v.contentDetails?.duration),
        };
      }
    }
    return out;
  }
}
