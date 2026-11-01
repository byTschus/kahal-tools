export type ToolKey = 'livestream' | 'podcast' | 'visitors';
export type ActionKey = 'view' | 'create' | 'edit' | 'delete' | 'settings';
export type PermissionMap = Partial<Record<ToolKey, ActionKey[]>>;

export interface Me {
  user: { id: string; name: string; email: string | null; avatarUrl: string | null; isAdmin: boolean; status: string };
  tenant: { id: string; name: string; slug: string; provider: string; timeZone: string };
  permissions: PermissionMap;
  tools: { key: ToolKey; label: string }[];
  actions: { key: ActionKey; label: string }[];
}

export interface PlanningEvent {
  id: string;
  title: string;
  subtitle?: string;
  sourceName?: string;
  startsAt: string | null;
  url?: string;
  /** Mit ?tool=…: Eintrag, dem der Plan bereits zugeordnet ist */
  linked?: { id: string; title: string } | null;
}

export interface Broadcast {
  id: string;
  title: string;
  description: string;
  scheduledStart: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: 'upcoming' | 'live' | 'completed';
  privacy: 'public' | 'unlisted' | 'private';
  thumbnailUrl?: string;
  url: string;
  editUrl?: string;
  planId?: string | null;
  planTitle?: string | null;
  peakConcurrent?: number | null;
  viewCount?: number | null;
  hasPodcast?: boolean;
}

export interface Podcast {
  id: string;
  sourceVideoId: string | null;
  planId: string | null;
  planTitle: string | null;
  title: string;
  speaker: string | null;
  scripture: string | null;
  description: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  startSec: number | null;
  endSec: number | null;
  fileName: string | null;
  imported: boolean;
  audioUrl: string | null;
  fileSize: number | null;
  durationSec: number | null;
  status: 'queued' | 'processing' | 'published' | 'failed';
  progress: number;
  error: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface VisitorLocation {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface VisitorCount {
  id: string;
  planId: string | null;
  eventTitle: string;
  eventDate: string;
  livestreamEnabled: boolean;
  livestreamMode: 'concurrent' | 'views' | null;
  livestreamVideoId: string | null;
  livestreamCount: number | null;
  notes: string | null;
  imported: boolean;
  values: { locationId: string; value: number }[];
}

export interface HostField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox';
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
}

export interface Integrations {
  streaming: { provider: string; label: string; config: { accountName?: string; avatarUrl?: string } } | null;
  podcastHost: { provider: string; config: Record<string, any>; secretsSet: Record<string, boolean> } | null;
  available: {
    streaming: { key: string; label: string; globalApp: boolean }[];
    podcastHost: { key: string; label: string; fields: HostField[] }[];
  };
  feedUrl: string;
}
