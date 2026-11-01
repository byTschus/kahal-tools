import { Check, Code, Copy, Download, Mic, Pencil, Plus, RotateCcw, Rss, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlanLink, type PlanRef } from '../components/PlanLink';
import { Alert, Badge, Button, Card, Checkbox, ConfirmButton, Empty, Field, Modal, PageHeader, Progress, Spinner, Tabs } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { useCan, useMe } from '../lib/auth';
import { fmtBytes, fmtDate, fmtDuration, fromLocalInput, toLocalInput } from '../lib/format';
import type { Integrations, Podcast } from '../lib/types';

const STATUS: Record<Podcast['status'], { label: string; color?: 'green' | 'red' | 'blue' | 'yellow' }> = {
  queued: { label: 'In Warteschlange', color: 'yellow' },
  processing: { label: 'Wird verarbeitet', color: 'blue' },
  published: { label: 'Veröffentlicht', color: 'green' },
  failed: { label: 'Fehlgeschlagen', color: 'red' },
};

const durationOf = (p: Podcast) => p.durationSec ?? (p.endSec != null && p.startSec != null ? p.endSec - p.startSec : null);

export function PodcastPage() {
  const can = useCan();
  const { data, loading, error, reload } = useApi<Podcast[]>('/api/podcasts');
  const { data: integrations } = useApi<Integrations>('/api/integrations');
  const [editing, setEditing] = useState<Podcast | null>(null);
  const [importing, setImporting] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);

  // Solange Podcasts verarbeitet werden, regelmässig aktualisieren
  const pending = data?.some((p) => p.status === 'queued' || p.status === 'processing');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [pending, reload]);

  const remove = async (p: Podcast) => {
    const res = await api.del<{ warning?: string }>(`/api/podcasts/${p.id}`);
    setMessage(res.warning ? { kind: 'warning', text: res.warning } : { kind: 'success', text: `„${p.title}“ wurde gelöscht.` });
    void reload();
  };

  const retry = async (p: Podcast) => {
    await api.post(`/api/podcasts/${p.id}/retry`);
    void reload();
  };

  return (
    <>
      <PageHeader title="Podcast" description="Predigten aus vergangenen Streams schneiden und veröffentlichen.">
        <Button icon={Code} onClick={() => setEmbedding(true)}>
          Einbetten
        </Button>
        {can('podcast', 'create') && (
          <Button icon={Download} onClick={() => setImporting(true)}>
            Feed importieren
          </Button>
        )}
        {can('podcast', 'create') && (
          <Link to="/podcast/new" className="btn primary">
            <Plus size={16} /> Neuer Podcast
          </Link>
        )}
      </PageHeader>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {integrations && !integrations.podcastHost && (
        <Alert kind="warning">
          Es ist noch kein Podcast-Hosting (FTP) eingerichtet. <Link to="/settings/podcast">Einstellungen öffnen</Link>
        </Alert>
      )}
      {integrations && (
        <Card>
          <div className="row between" style={{ flexWrap: 'nowrap' }}>
            <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
              <span className="icon-tile">
                <Rss size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="label">RSS-Feed für Apple Podcasts, Spotify & Co.</div>
                <div className="cell-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{integrations.feedUrl}</div>
              </div>
            </div>
            <CopyButton text={integrations.feedUrl} />
          </div>
        </Card>
      )}
      <Card>
        {error ? (
          <Alert>{error.message}</Alert>
        ) : loading && !data ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={Mic} title="Noch keine Podcasts">Erstelle den ersten Podcast aus einem vergangenen Livestream oder importiere einen bestehenden Feed.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Titel</th>
                  <th>Status</th>
                  <th className="num">Dauer</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td style={{ width: 64 }}>{p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6 }} />}</td>
                    <td>
                      <div className="cell-title">{p.title}</div>
                      <div className="cell-sub">
                        {[p.speaker, p.scripture, fmtDate(p.publishedAt ?? p.createdAt), p.fileSize ? fmtBytes(p.fileSize) : null].filter(Boolean).join(' · ')}
                      </div>
                      <div className="cell-sub">{p.planTitle ? `Plan: ${p.planTitle}` : p.imported ? 'Importiert, kein Plan verknüpft' : 'Kein Plan verknüpft'}</div>
                      {p.status === 'published' && p.audioUrl && <audio controls preload="none" src={p.audioUrl} style={{ display: 'block', marginTop: 6, height: 32, maxWidth: 320 }} />}
                      {p.error && <div style={{ color: 'var(--danger)', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{p.error}</div>}
                    </td>
                    <td>
                      <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                        <Badge color={STATUS[p.status].color}>{STATUS[p.status].label}</Badge>
                        {p.status === 'processing' && <Progress value={p.progress} />}
                        {p.imported && <Badge plain>Importiert</Badge>}
                      </div>
                    </td>
                    <td className="num">{fmtDuration(durationOf(p))}</td>
                    <td>
                      <div className="actions">
                        {p.status === 'failed' && can('podcast', 'create') && (
                          <Button size="small" icon={RotateCcw} onClick={() => retry(p)}>
                            Neu versuchen
                          </Button>
                        )}
                        {can('podcast', 'edit') && (
                          <Button size="small" icon={Pencil} onClick={() => setEditing(p)}>
                            Bearbeiten
                          </Button>
                        )}
                        {can('podcast', 'delete') && p.status !== 'processing' && (
                          <ConfirmButton
                            icon={Trash2}
                            title="Löschen"
                            aria-label="Löschen"
                            question={p.imported ? `Importierte Episode „${p.title}“ entfernen? Die Audiodatei beim bisherigen Anbieter bleibt bestehen.` : `Podcast „${p.title}“ inkl. Audiodatei löschen?`}
                            onConfirm={() => remove(p)}
                          >
                            {null}
                          </ConfirmButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <PodcastEditModal
          podcast={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage({ kind: 'success', text: 'Podcast wurde gespeichert.' });
            void reload();
          }}
        />
      )}
      {importing && (
        <FeedImportModal
          onClose={() => setImporting(false)}
          onDone={(text) => {
            setImporting(false);
            setMessage({ kind: 'success', text });
            void reload();
          }}
        />
      )}
      {embedding && <EmbedModal onClose={() => setEmbedding(false)} />}
    </>
  );
}

function CopyButton({ text, label = 'Kopieren' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="small"
      icon={copied ? Check : Copy}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Kopiert' : label}
    </Button>
  );
}

function PodcastEditModal({ podcast, onClose, onSaved }: { podcast: Podcast; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: podcast.title,
    speaker: podcast.speaker ?? '',
    scripture: podcast.scripture ?? '',
    description: podcast.description ?? '',
    imageUrl: podcast.imageUrl ?? '',
    publishedAt: toLocalInput(podcast.publishedAt),
  });
  const [plan, setPlan] = useState<PlanRef | null>(podcast.planId ? { id: podcast.planId, title: podcast.planTitle } : null);
  const save = useAction();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async () => {
    const ok = await save.run(() =>
      api.patch(`/api/podcasts/${podcast.id}`, {
        ...form,
        publishedAt: form.publishedAt ? fromLocalInput(form.publishedAt) : undefined,
        ...((plan?.id ?? null) !== podcast.planId ? { eventId: plan?.id ?? null, eventTitle: plan?.title ?? null } : {}),
      }),
    );
    if (ok) onSaved();
  };

  return (
    <Modal
      title="Podcast bearbeiten"
      onClose={onClose}
      footer={
        <Button variant="primary" busy={save.busy} onClick={submit}>
          Speichern
        </Button>
      }
    >
      <Alert>{save.error}</Alert>
      <Field label="Plan">
        <PlanLink tool="podcast" ownId={podcast.id} value={plan} onChange={setPlan} />
      </Field>
      <Field label="Titel">
        <input type="text" value={form.title} onChange={set('title')} />
      </Field>
      <div className="grid grid-2">
        <Field label="Sprecher">
          <input type="text" value={form.speaker} onChange={set('speaker')} />
        </Field>
        <Field label="Bibelstelle">
          <input type="text" value={form.scripture} onChange={set('scripture')} />
        </Field>
      </div>
      <Field label="Beschreibung">
        <textarea className="prose" rows={6} value={form.description} onChange={set('description')} />
      </Field>
      <Field label="Bild-URL">
        <input type="text" value={form.imageUrl} onChange={set('imageUrl')} />
      </Field>
      {podcast.status === 'published' && (
        <Field label="Veröffentlicht am" hint="Bestimmt die Reihenfolge im Feed">
          <input type="datetime-local" value={form.publishedAt} onChange={set('publishedAt')} />
        </Field>
      )}
      <small>Hinweis: Änderungen wirken sich auf den Feed aus. Die ID3-Tags in der bereits hochgeladenen MP3-Datei bleiben unverändert.</small>
    </Modal>
  );
}

interface FeedPreview {
  channel: { title: string; description: string; author: string; imageUrl: string };
  total: number;
  new: number;
  episodes: { title: string; publishedAt: string | null; durationSec: number | null; isNew: boolean }[];
}

function FeedImportModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [url, setUrl] = useState('');
  const [adoptChannel, setAdoptChannel] = useState(true);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const load = useAction();
  const run = useAction();

  const loadPreview = async () => {
    setPreview(null);
    const res = await load.run(() => api.post<FeedPreview>('/api/podcasts/import-feed', { url }));
    if (res) setPreview(res);
  };

  const commit = async () => {
    const res = await run.run(() => api.post<{ imported: number; skipped: number }>('/api/podcasts/import-feed', { url, commit: true, adoptChannel }));
    if (res) onDone(`${res.imported} Episoden importiert${res.skipped ? `, ${res.skipped} bereits vorhanden` : ''}.`);
  };

  return (
    <Modal
      title="Bestehenden Podcast-Feed importieren"
      wide
      onClose={onClose}
      footer={
        preview ? (
          <Button variant="primary" busy={run.busy} disabled={!preview.new} onClick={commit}>
            {preview.new} Episoden importieren
          </Button>
        ) : null
      }
    >
      <p className="muted">
        Übernimmt die Episoden eines bestehenden RSS-Feeds. Die Audiodateien bleiben beim bisherigen Anbieter und werden verlinkt. Einen Plan kannst du später beim
        Bearbeiten einer Episode verknüpfen.
      </p>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="url" placeholder="https://… /feed.xml" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && loadPreview()} />
        <Button busy={load.busy} disabled={!url.trim()} onClick={loadPreview}>
          Feed laden
        </Button>
      </div>
      <Alert>{load.error ?? run.error}</Alert>
      {preview && (
        <div className="stack">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {preview.channel.imageUrl && <img src={preview.channel.imageUrl} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6 }} />}
            <div>
              <div className="cell-title">{preview.channel.title || 'Ohne Titel'}</div>
              <div className="cell-sub">
                {preview.total} Episoden, davon {preview.new} neu
              </div>
            </div>
          </div>
          <div className="scroll-list" style={{ maxHeight: 260 }}>
            {preview.episodes.map((e, i) => (
              <div key={i} className="list-item" style={{ cursor: 'default', opacity: e.isNew ? 1 : 0.55 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-title">{e.title}</div>
                  <div className="cell-sub">
                    {fmtDate(e.publishedAt, false)} {e.durationSec ? `· ${fmtDuration(e.durationSec)}` : ''}
                  </div>
                </div>
                {!e.isNew && <Badge plain>bereits vorhanden</Badge>}
              </div>
            ))}
          </div>
          <Checkbox checked={adoptChannel} onChange={setAdoptChannel} label="Leere Feed-Angaben (Titel, Beschreibung, Autor, Bild …) aus diesem Feed übernehmen" />
        </div>
      )}
    </Modal>
  );
}

function EmbedModal({ onClose }: { onClose: () => void }) {
  const { me } = useMe();
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const base = `${window.location.origin}/embed/${me.tenant.slug}/podcast`;
  const src = theme === 'auto' ? base : `${base}?theme=${theme}`;
  const code = `<iframe src="${src}" title="Predigten" width="100%" height="250" style="max-width:560px;border:0" loading="lazy"></iframe>`;
  return (
    <Modal title="Podcast einbetten" wide onClose={onClose}>
      <p className="muted">
        Zeigt die neueste Predigt mit Player und Video-Link auf eurer Webseite. Mit den Pfeilen lässt sich durch ältere Predigten blättern. Den Code einfach in
        die Webseite einfügen.
      </p>
      <Tabs
        tabs={[
          { key: 'auto', label: 'Automatisch' },
          { key: 'light', label: 'Hell' },
          { key: 'dark', label: 'Dunkel' },
        ]}
        value={theme}
        onChange={setTheme}
      />
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <code style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: '0.8rem', padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>{code}</code>
        <CopyButton text={code} />
      </div>
      <div className="label" style={{ marginTop: 8 }}>
        Vorschau
      </div>
      <iframe key={src} src={src} title="Vorschau" width="100%" height="250" style={{ maxWidth: 560, border: 0 }} />
      <small>Farbe anpassen: an die Adresse „?accent=1f6f5c“ anhängen (Hex-Farbcode ohne #).</small>
    </Modal>
  );
}
