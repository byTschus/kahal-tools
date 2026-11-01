import { ArrowLeft, ExternalLink, Eye, Pencil, Plus, Radio, RefreshCw, Trash2, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EventPicker } from '../components/EventPicker';
import { Alert, Badge, Button, Card, ConfirmButton, Empty, Field, Modal, PageHeader, Spinner, Tabs } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { useCan } from '../lib/auth';
import { fmtDate, fmtNumber, fromLocalInput, toLocalInput } from '../lib/format';
import type { Broadcast, PlanningEvent } from '../lib/types';

type Status = 'upcoming' | 'active' | 'completed';

const STATUS_BADGE: Record<Broadcast['status'], ReactNode> = {
  upcoming: <Badge color="blue">Geplant</Badge>,
  live: <Badge color="live">Live</Badge>,
  completed: <Badge>Beendet</Badge>,
};

const PRIVACY: Record<Broadcast['privacy'], string> = { public: 'Öffentlich', unlisted: 'Nicht gelistet', private: 'Privat' };

export function LivestreamPage() {
  const can = useCan();
  const [status, setStatus] = useState<Status>('upcoming');
  const { data, loading, error, reload } = useApi<{ items: Broadcast[] }>(`/api/livestreams?status=${status}`);
  const [editing, setEditing] = useState<Broadcast | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const remove = async (b: Broadcast) => {
    await api.del(`/api/livestreams/${b.id}`);
    setMessage(`„${b.title}“ wurde gelöscht.`);
    void reload();
  };

  return (
    <>
      <PageHeader title="Livestream" description="Streams für die kommenden Gottesdienste planen und verwalten.">
        {can('livestream', 'create') && (
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            Neuer Livestream
          </Button>
        )}
      </PageHeader>
      <Alert kind="success">{message}</Alert>
      <Card>
        <Tabs
          tabs={[
            { key: 'upcoming', label: 'Geplant' },
            { key: 'active', label: 'Live' },
            { key: 'completed', label: 'Vergangen' },
          ]}
          value={status}
          onChange={setStatus}
        />
        {error?.code === 'no-streaming' ? (
          <Empty icon={Radio} title="Noch kein YouTube-Kanal verbunden">
            <Link to="/settings/livestream">In den Einstellungen verbinden</Link>
          </Empty>
        ) : error ? (
          <Alert>{error.message}</Alert>
        ) : loading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty icon={Radio} title="Keine Livestreams">In dieser Ansicht gibt es noch keine Streams.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Titel</th>
                  <th>Start</th>
                  <th>Status</th>
                  <th className="num">Zuschauer</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id}>
                    <td style={{ width: 110 }}>{b.thumbnailUrl && <img className="thumb" src={b.thumbnailUrl} alt="" />}</td>
                    <td>
                      <div className="cell-title">{b.title}</div>
                      <div className="cell-sub">
                        {PRIVACY[b.privacy]}
                        {b.planTitle ? ` · ${b.planTitle}` : ''}
                      </div>
                    </td>
                    <td>{fmtDate(b.actualStart ?? b.scheduledStart)}</td>
                    <td>{STATUS_BADGE[b.status]}</td>
                    <td className="num">
                      <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
                        {b.peakConcurrent != null && (
                          <span className="meta" title="Max. gleichzeitige Zuschauer">
                            <Users size={14} /> {fmtNumber(b.peakConcurrent)}
                          </span>
                        )}
                        {b.viewCount != null && (
                          <span className="meta" title="Aufrufe">
                            <Eye size={14} /> {fmtNumber(b.viewCount)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="actions">
                        <a className="btn small icon-only" href={b.url} target="_blank" rel="noreferrer" title="Auf YouTube öffnen" aria-label="Auf YouTube öffnen">
                          <ExternalLink size={15} />
                        </a>
                        {can('livestream', 'edit') && b.status !== 'completed' && (
                          <Button size="small" icon={Pencil} onClick={() => setEditing(b)}>
                            Bearbeiten
                          </Button>
                        )}
                        {can('livestream', 'delete') && (
                          <ConfirmButton icon={Trash2} title="Löschen" aria-label="Löschen" question={`Livestream „${b.title}“ auf YouTube löschen?`} onConfirm={() => remove(b)}>
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
        <LivestreamModal
          broadcast={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setMessage(msg);
            void reload();
          }}
        />
      )}
    </>
  );
}

interface Prepared {
  title: string;
  description: string;
  scheduledStart: string | null;
  startSource: string;
  privacy: Broadcast['privacy'];
}

function LivestreamModal({ broadcast, onClose, onSaved }: { broadcast: Broadcast | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [event, setEvent] = useState<PlanningEvent | null>(null);
  const [step, setStep] = useState<'event' | 'form'>(broadcast ? 'form' : 'event');
  const [freitext, setFreitext] = useState('');
  const [title, setTitle] = useState(broadcast?.title ?? '');
  const [description, setDescription] = useState(broadcast?.description ?? '');
  const [start, setStart] = useState(toLocalInput(broadcast?.scheduledStart));
  const [privacy, setPrivacy] = useState<Broadcast['privacy']>(broadcast?.privacy ?? 'public');
  const [startSource, setStartSource] = useState<string | null>(null);
  const prep = useAction();
  const save = useAction();

  const prepare = async (ev: PlanningEvent, text = freitext) => {
    const res = await prep.run(() => api.post<Prepared>('/api/livestreams/prepare', { eventId: ev.id, freitext: text }));
    if (!res) return;
    setTitle(res.title);
    setDescription(res.description);
    if (!broadcast) {
      setStart(toLocalInput(res.scheduledStart));
      setPrivacy(res.privacy);
      setStartSource(res.startSource);
    }
    setStep('form');
  };

  const submit = async () => {
    const body = {
      title,
      description,
      scheduledStart: fromLocalInput(start),
      privacy,
      ...(event ? { eventId: event.id, eventTitle: event.title } : {}),
    };
    const ok = await save.run(() => (broadcast ? api.patch(`/api/livestreams/${broadcast.id}`, body) : api.post('/api/livestreams', body)));
    if (ok) onSaved(broadcast ? 'Livestream wurde aktualisiert.' : 'Livestream wurde auf YouTube erstellt.');
  };

  return (
    <Modal
      title={broadcast ? 'Livestream bearbeiten' : 'Neuer Livestream'}
      onClose={onClose}
      wide={step === 'event'}
      footer={
        step === 'form' ? (
          <>
            {!broadcast && (
              <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep('event')}>
                Anderer Plan
              </Button>
            )}
            {broadcast && (
              <Button icon={RefreshCw} onClick={() => setStep('event')} title="Titel und Beschreibung aus einem Plan neu generieren">
                Aus Plan neu generieren
              </Button>
            )}
            <Button variant="primary" busy={save.busy} onClick={submit} disabled={!title || !start}>
              {broadcast ? 'Speichern' : 'Livestream erstellen'}
            </Button>
          </>
        ) : null
      }
    >
      {step === 'event' ? (
        <>
          <p className="muted">Wähle den Plan aus, für den der Livestream erstellt werden soll.</p>
          <Alert>{prep.error}</Alert>
          {prep.busy && <Spinner label="Plan wird ausgewertet …" />}
          <EventPicker
            value={event?.id ?? null}
            onChange={(ev) => {
              setEvent(ev);
              void prepare(ev);
            }}
          />
        </>
      ) : (
        <>
          <Alert>{save.error ?? prep.error}</Alert>
          {event && (
            <Alert kind="info">
              Plan: <b>{event.title}</b> ({fmtDate(event.startsAt)})
            </Alert>
          )}
          <Field label="Titel" hint={`${title.length}/100 Zeichen`}>
            <input type="text" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Beschreibung">
            <textarea className="prose" rows={7} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {event && (
            <Field label="Freitext" hint="Wird im Template als {{freitext}} eingesetzt">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="text" value={freitext} onChange={(e) => setFreitext(e.target.value)} />
                <Button busy={prep.busy} onClick={() => prepare(event, freitext)}>
                  Übernehmen
                </Button>
              </div>
            </Field>
          )}
          <div className="grid grid-2">
            <Field label="Start" hint={startSource ? `Aus Plan: ${startSource}` : undefined}>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Sichtbarkeit">
              <select value={privacy} onChange={(e) => setPrivacy(e.target.value as Broadcast['privacy'])}>
                <option value="public">Öffentlich</option>
                <option value="unlisted">Nicht gelistet</option>
                <option value="private">Privat</option>
              </select>
            </Field>
          </div>
        </>
      )}
    </Modal>
  );
}
