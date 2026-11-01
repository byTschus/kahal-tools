import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, ConfirmButton, Empty, Field, Modal, PageHeader, Progress, Spinner } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { useCan } from '../lib/auth';
import { fmtBytes, fmtDate, fmtDuration, fromLocalInput, toLocalInput } from '../lib/format';
import type { Integrations, Podcast } from '../lib/types';

const STATUS: Record<Podcast['status'], { label: string; color?: 'green' | 'red' | 'blue' | 'yellow' }> = {
  queued: { label: 'In Warteschlange', color: 'yellow' },
  processing: { label: 'Wird verarbeitet', color: 'blue' },
  published: { label: 'Veröffentlicht', color: 'green' },
  failed: { label: 'Fehlgeschlagen', color: 'red' },
};

export function PodcastPage() {
  const can = useCan();
  const { data, loading, error, reload } = useApi<Podcast[]>('/api/podcasts');
  const { data: integrations } = useApi<Integrations>('/api/integrations');
  const [editing, setEditing] = useState<Podcast | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

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
      <PageHeader title="🎙️ Podcast">
        {can('podcast', 'create') && (
          <Link to="/podcast/new" className="btn primary">
            ＋ Neuer Podcast
          </Link>
        )}
      </PageHeader>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {integrations && !integrations.podcastHost && (
        <Alert kind="warning">
          Es ist noch kein Podcast-Hosting (FTP) eingerichtet. <Link to="/settings/podcast">Einstellungen öffnen →</Link>
        </Alert>
      )}
      {integrations && (
        <Card>
          <div className="row between">
            <div>
              <div className="label">RSS-Feed für Apple Podcasts, Spotify & Co.</div>
              <code>{integrations.feedUrl}</code>
            </div>
            <Button
              size="small"
              onClick={async () => {
                await navigator.clipboard.writeText(integrations.feedUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? '✓ Kopiert' : 'Kopieren'}
            </Button>
          </div>
        </Card>
      )}
      <Card>
        {error ? (
          <Alert>{error.message}</Alert>
        ) : loading && !data ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty>Noch keine Podcasts erstellt.</Empty>
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
                      <div style={{ fontWeight: 600 }}>{p.title}</div>
                      <small>
                        {p.speaker ? `${p.speaker} · ` : ''}
                        {fmtDate(p.publishedAt ?? p.createdAt)}
                        {p.fileSize ? ` · ${fmtBytes(p.fileSize)}` : ''}
                      </small>
                      {p.status === 'published' && p.audioUrl && <audio controls preload="none" src={p.audioUrl} style={{ display: 'block', marginTop: 6, height: 32, maxWidth: 320 }} />}
                      {p.error && <div style={{ color: 'var(--danger)', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{p.error}</div>}
                    </td>
                    <td>
                      <Badge color={STATUS[p.status].color}>{STATUS[p.status].label}</Badge>
                      {p.status === 'processing' && <Progress value={p.progress} />}
                    </td>
                    <td className="num">{fmtDuration(p.durationSec ?? p.endSec - p.startSec)}</td>
                    <td>
                      <div className="actions">
                        {p.status === 'failed' && can('podcast', 'create') && (
                          <Button size="small" onClick={() => retry(p)}>
                            Neu versuchen
                          </Button>
                        )}
                        {can('podcast', 'edit') && (
                          <Button size="small" onClick={() => setEditing(p)}>
                            Bearbeiten
                          </Button>
                        )}
                        {can('podcast', 'delete') && p.status !== 'processing' && (
                          <ConfirmButton question={`Podcast „${p.title}“ inkl. Audiodatei löschen?`} onConfirm={() => remove(p)} />
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
    </>
  );
}

function PodcastEditModal({ podcast, onClose, onSaved }: { podcast: Podcast; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: podcast.title,
    speaker: podcast.speaker ?? '',
    description: podcast.description ?? '',
    imageUrl: podcast.imageUrl ?? '',
    publishedAt: toLocalInput(podcast.publishedAt),
  });
  const save = useAction();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <Modal
      title="Podcast bearbeiten"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          busy={save.busy}
          onClick={async () => {
            const ok = await save.run(() =>
              api.patch(`/api/podcasts/${podcast.id}`, { ...form, publishedAt: form.publishedAt ? fromLocalInput(form.publishedAt) : undefined }),
            );
            if (ok) onSaved();
          }}
        >
          Speichern
        </Button>
      }
    >
      <Alert>{save.error}</Alert>
      <Field label="Titel">
        <input type="text" value={form.title} onChange={set('title')} />
      </Field>
      <Field label="Sprecher">
        <input type="text" value={form.speaker} onChange={set('speaker')} />
      </Field>
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
