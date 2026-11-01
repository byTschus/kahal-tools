import { ImageOff, ImagePlus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, useAction, useApi } from '../lib/api';
import { proxiedImageUrl } from '../lib/image';
import { Alert, Button, Tabs } from './ui';

export type ThumbnailChoice = { kind: 'none' } | { kind: 'url'; url: string } | { kind: 'file'; file: File };

/** Thumbnail wählen: Bild aus dem Plan, eigenes Bild oder keines (bzw. unverändert beim Bearbeiten) */
export function ThumbnailPicker({
  planImageUrl,
  value,
  onChange,
  currentUrl,
}: {
  planImageUrl?: string | null;
  value: ThumbnailChoice;
  onChange: (v: ThumbnailChoice) => void;
  /** Bestehendes Thumbnail (beim Bearbeiten) */
  currentUrl?: string | null;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    if (value.kind !== 'file') return setFileUrl(null);
    const url = URL.createObjectURL(value.file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const preview = value.kind === 'file' ? fileUrl : value.kind === 'url' ? proxiedImageUrl(value.url) : currentUrl;
  const tabs = [
    ...(planImageUrl ? [{ key: 'url' as const, label: 'Bild aus Plan' }] : []),
    { key: 'file' as const, label: 'Eigenes Bild' },
    { key: 'none' as const, label: currentUrl ? 'Unverändert' : 'Keines' },
  ];

  return (
    <div className="stack" style={{ gap: 8 }}>
      <Tabs
        tabs={tabs}
        value={value.kind}
        onChange={(k) => {
          if (k === 'url' && planImageUrl) onChange({ kind: 'url', url: planImageUrl });
          if (k === 'none') onChange({ kind: 'none' });
          if (k === 'file') document.getElementById('thumbnail-file')?.click();
        }}
      />
      <input
        id="thumbnail-file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange({ kind: 'file', file });
          e.target.value = '';
        }}
      />
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        <div
          style={{
            width: 176,
            aspectRatio: '16 / 9',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--surface-2)',
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
          }}
        >
          {preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageOff size={20} color="var(--muted)" />}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="btn small" style={{ cursor: 'pointer', alignSelf: 'flex-start' }} htmlFor="thumbnail-file">
            <ImagePlus size={15} /> Bild hochladen
          </label>
          <small>Wird auf 1280×720 zugeschnitten. YouTube erlaubt eigene Thumbnails nur für bestätigte Kanäle.</small>
        </div>
      </div>
    </div>
  );
}

interface Playlist {
  id: string;
  name: string;
}

/** Playlist wählen oder direkt eine neue erstellen */
export function PlaylistSelect({ value, onChange, emptyLabel = 'Keine Playlist' }: { value: string; onChange: (id: string) => void; emptyLabel?: string }) {
  const { data, loading, error, reload } = useApi<Playlist[]>('/api/livestreams/playlists');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('public');
  const create = useAction();

  const submit = async () => {
    const playlist = await create.run(() => api.post<Playlist>('/api/livestreams/playlists', { name, privacy }));
    if (!playlist) return;
    await reload();
    onChange(playlist.id);
    setCreating(false);
    setName('');
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={loading && !data}>
          <option value="">{loading && !data ? 'Playlists werden geladen …' : emptyLabel}</option>
          {data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {!creating && (
          <Button size="small" icon={Plus} onClick={() => setCreating(true)}>
            Neue Playlist
          </Button>
        )}
      </div>
      {error && <Alert>{error.message}</Alert>}
      {creating && (
        <div className="card-subtle stack" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="text" autoFocus placeholder="Name der Playlist, z.B. Predigtreihe Psalmen" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} />
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)} style={{ maxWidth: 160 }}>
              <option value="public">Öffentlich</option>
              <option value="unlisted">Nicht gelistet</option>
              <option value="private">Privat</option>
            </select>
          </div>
          <Alert>{create.error}</Alert>
          <div className="row">
            <Button size="small" variant="primary" busy={create.busy} disabled={!name.trim()} onClick={submit}>
              Erstellen
            </Button>
            <Button size="small" variant="ghost" onClick={() => setCreating(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
