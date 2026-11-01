/**
 * Schnittstelle für Streaming-Plattformen (YouTube, später z.B. Vimeo, Facebook, Restream ...).
 * Neue Plattform: StreamingProvider implementieren und in ./index.ts registrieren.
 */

export interface StreamingSecrets {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export type BroadcastStatus = 'upcoming' | 'live' | 'completed';
export type Privacy = 'public' | 'unlisted' | 'private';

export interface Broadcast {
  id: string;
  title: string;
  description: string;
  scheduledStart: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: BroadcastStatus;
  privacy: Privacy;
  thumbnailUrl?: string;
  url: string;
}

export interface BroadcastInput {
  title: string;
  description: string;
  scheduledStart: string;
  privacy: Privacy;
  streamKeyId?: string;
  playlistId?: string;
  autoStart?: boolean;
  autoStop?: boolean;
}

export interface VideoStats {
  concurrentViewers?: number;
  viewCount?: number;
  status?: BroadcastStatus;
  durationSec?: number;
}

export interface StreamingClient {
  getAccount(): Promise<{ id: string; name: string; avatarUrl?: string }>;
  listStreamKeys(): Promise<{ id: string; name: string }[]>;
  listPlaylists(): Promise<{ id: string; name: string }[]>;
  listBroadcasts(status: 'upcoming' | 'active' | 'completed' | 'all', pageToken?: string): Promise<{ items: Broadcast[]; nextPageToken?: string }>;
  getBroadcast(id: string): Promise<Broadcast | null>;
  createBroadcast(input: BroadcastInput): Promise<Broadcast>;
  updateBroadcast(id: string, input: Partial<BroadcastInput>): Promise<Broadcast>;
  deleteBroadcast(id: string): Promise<void>;
  getStats(ids: string[]): Promise<Record<string, VideoStats>>;
}

export interface StreamingProvider {
  key: string;
  label: string;
  isConfigured(): boolean;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<StreamingSecrets>;
  /** onTokens wird aufgerufen, wenn Tokens erneuert wurden (zum Speichern) */
  createClient(secrets: StreamingSecrets, onTokens: (s: StreamingSecrets) => Promise<void>): StreamingClient;
  /** Öffentliche URL eines Videos (z.B. für den Podcast-Download) */
  videoUrl(id: string): string;
}
