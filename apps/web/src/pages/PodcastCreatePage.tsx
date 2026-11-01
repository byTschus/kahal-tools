import { ArrowLeft, ArrowLeftToLine, ArrowRightToLine, Check, FileText, Mic, Play, SkipForward } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EventPicker } from '../components/EventPicker';
import { Alert, Badge, Button, Card, Empty, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { YouTubePlayer, type PlayerHandle } from '../components/YouTubePlayer';
import { api, useAction, useApi } from '../lib/api';
import { fmtDate, fmtDuration, parseDuration } from '../lib/format';
import type { Broadcast, PlanningEvent } from '../lib/types';

interface Prepared {
  eventId: string | null;
  event: { id: string; title: string; startsAt: string | null } | null;
  /** Titel des Podcasts, dem der Plan bereits zugeordnet ist */
  eventLinkedTo: string | null;
  video: Broadcast & { durationSec: number | null };
  title: string;
  speaker: string;
  scripture: string;
  description: string;
  imageUrl: string;
}

export function PodcastCreatePage() {
  const [video, setVideo] = useState<Broadcast | null>(null);
  return (
    <>
      <PageHeader title="Neuer Podcast" description="Livestream wählen, Ausschnitt festlegen, Angaben prüfen.">
        <Link to="/podcast" className="btn">
          <ArrowLeft size={16} /> Zurück
        </Link>
      </PageHeader>
      {video ? <PodcastEditor video={video} onBack={() => setVideo(null)} /> : <SourcePicker onSelect={setVideo} />}
    </>
  );
}

function SourcePicker({ onSelect }: { onSelect: (b: Broadcast) => void }) {
  const [pageToken, setPageToken] = useState<string | undefined>();
  const [items, setItems] = useState<Broadcast[]>([]);
  const { data, loading, error } = useApi<{ items: Broadcast[]; nextPageToken?: string }>(
    `/api/podcasts/sources${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`,
  );
  useEffect(() => {
    if (data) setItems((prev) => [...prev.filter((p) => !data.items.some((d) => d.id === p.id)), ...data.items]);
  }, [data]);

  return (
    <Card title="1. Vergangenen Livestream auswählen">
      {error?.code === 'no-streaming' ? (
        <Empty icon={Mic} title="Noch kein YouTube-Kanal verbunden">
          <Link to="/settings/livestream">In den Einstellungen verbinden</Link>
        </Empty>
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {items.map((b) => (
            <button key={b.id} className="list-item" onClick={() => onSelect(b)}>
              {b.thumbnailUrl && <img className="thumb" src={b.thumbnailUrl} alt="" />}
              <div style={{ flex: 1 }}>
                <div className="cell-title">{b.title}</div>
                <div className="cell-sub">
                  {fmtDate(b.actualStart ?? b.scheduledStart)}
                  {b.planTitle ? ` · ${b.planTitle}` : ''}
                </div>
              </div>
              {b.hasPodcast && (
                <Badge color="green" plain>
                  <Check size={12} /> Podcast vorhanden
                </Badge>
              )}
            </button>
          ))}
          {loading && <Spinner />}
          {!loading && items.length === 0 && <Empty>Keine vergangenen Livestreams gefunden.</Empty>}
          {data?.nextPageToken && !loading && (
            <Button onClick={() => setPageToken(data.nextPageToken)} style={{ alignSelf: 'center' }}>
              Weitere laden
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function PodcastEditor({ video, onBack }: { video: Broadcast; onBack: () => void }) {
  const navigate = useNavigate();
  const player = useRef<PlayerHandle>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [form, setForm] = useState({ title: '', speaker: '', scripture: '', description: '', imageUrl: '' });
  const [pdf, setPdf] = useState<File | null>(null);
  const [pickEvent, setPickEvent] = useState(false);
  const prep = useAction();
  const save = useAction();

  const load = async (eventId?: string | null) => {
    const res = await prep.run(() => api.post<Prepared>('/api/podcasts/prepare', { videoId: video.id, eventId }));
    if (!res) return;
    setPrepared(res);
    setForm({ title: res.title, speaker: res.speaker, scripture: res.scripture, description: res.description, imageUrl: res.imageUrl });
    if (res.video.durationSec) {
      setDuration((d) => d || res.video.durationSec!);
      setRange((r) => (r[1] ? r : [0, res.video.durationSec!]));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  const onReady = (d: number) => {
    if (!d) return;
    setDuration(d);
    setRange((r) => (r[1] ? r : [0, Math.floor(d)]));
  };

  const setStart = (sec: number) => setRange(([, end]) => [Math.max(0, Math.min(Math.floor(sec), end - 1)), end]);
  const setEnd = (sec: number) => setRange(([start]) => [start, Math.min(Math.floor(duration || sec), Math.max(Math.floor(sec), start + 1))]);
  const max = Math.max(1, Math.floor(duration));
  const pct = (sec: number) => `${(sec / max) * 100}%`;

  // Der Plan muss gewählt und noch keinem anderen Podcast zugeordnet sein
  const planOk = Boolean(prepared?.event && !prepared.eventLinkedTo);

  const submit = async () => {
    const res = await save.run(async () => {
      const podcast = await api.post<{ id: string }>('/api/podcasts', {
        videoId: video.id,
        eventId: prepared?.eventId ?? null,
        eventTitle: prepared?.event?.title ?? null,
        ...form,
        startSec: range[0],
        endSec: range[1],
      });
      if (pdf) await api.upload(`/api/podcasts/${podcast.id}/pdf`, pdf, 'application/pdf');
      return podcast;
    });
    if (res) navigate('/podcast');
  };

  return (
    <div className="editor-grid">
      <Card title="2. Ausschnitt wählen" actions={<Button size="small" onClick={onBack}>Anderes Video</Button>}>
        <YouTubePlayer ref={player} videoId={video.id} onReady={onReady} onTime={setCurrent} />
        <div className="range" aria-label="Ausschnitt">
          <div className="track" />
          <div className="sel" style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }} />
          <div className="cursor" style={{ left: pct(current) }} />
          <input type="range" min={0} max={max} value={range[0]} onChange={(e) => setStart(Number(e.target.value))} onMouseUp={() => player.current?.seekTo(range[0])} />
          <input type="range" min={0} max={max} value={range[1]} onChange={(e) => setEnd(Number(e.target.value))} onMouseUp={() => player.current?.seekTo(Math.max(0, range[1] - 5))} />
        </div>
        <div className="row between">
          <TimeBox label="Start" value={range[0]} onChange={setStart} />
          <div className="muted" style={{ textAlign: 'center' }}>
            Position {fmtDuration(current)}
            <br />
            Länge <b>{fmtDuration(range[1] - range[0])}</b>
          </div>
          <TimeBox label="Ende" value={range[1]} onChange={setEnd} />
        </div>
        <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
          <Button size="small" icon={ArrowLeftToLine} onClick={() => setStart(player.current?.getCurrentTime() ?? 0)}>
            Start setzen
          </Button>
          <Button size="small" variant="ghost" icon={Play} onClick={() => player.current?.seekTo(range[0], true)}>
            Ab Start
          </Button>
          <Button size="small" variant="ghost" icon={SkipForward} onClick={() => player.current?.seekTo(Math.max(0, range[1] - 10), true)}>
            Ende anhören
          </Button>
          <Button size="small" icon={ArrowRightToLine} onClick={() => setEnd(player.current?.getCurrentTime() ?? 0)}>
            Ende setzen
          </Button>
        </div>
      </Card>

      <Card title="3. Angaben prüfen">
        {prep.busy && !prepared && <Spinner label="Angaben werden aus dem Plan erstellt …" />}
        <Alert>{prep.error}</Alert>
        {prepared && (
          <div className="stack">
            <div className="row between">
              <div>
                <div className="label">Plan</div>
                {prepared.event ? (
                  <span>
                    {prepared.event.title} <small>({fmtDate(prepared.event.startsAt, false)})</small>
                  </span>
                ) : (
                  <small>Noch kein Plan gewählt</small>
                )}
              </div>
              <Button size="small" onClick={() => setPickEvent(true)}>
                {prepared.event ? 'Ändern' : 'Plan wählen'}
              </Button>
            </div>
            {!prepared.event && <Alert kind="warning">Bitte den Plan wählen, zu dem dieser Podcast gehört.</Alert>}
            {prepared.eventLinkedTo && (
              <Alert kind="warning">Dieser Plan ist bereits dem Podcast „{prepared.eventLinkedTo}“ zugeordnet. Bitte einen anderen Plan wählen.</Alert>
            )}
            <Field label="Titel">
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <div className="grid grid-2">
              <Field label="Sprecher">
                <input type="text" value={form.speaker} onChange={(e) => setForm({ ...form, speaker: e.target.value })} />
              </Field>
              <Field label="Bibelstelle">
                <input type="text" value={form.scripture} placeholder="z.B. Johannes 3,16" onChange={(e) => setForm({ ...form, scripture: e.target.value })} />
              </Field>
            </div>
            <Field label="Beschreibung">
              <textarea className="prose" rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Bild-URL">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                {form.imageUrl && <img src={form.imageUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />}
                <input type="text" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
              </div>
            </Field>
            <Field label="PDF (optional)" hint="z.B. Predigtnotizen oder Gottesdienst-Flyer. Wird neben der MP3 auf dem Podcast-Server gespeichert.">
              <PdfInput file={pdf} onChange={setPdf} />
            </Field>
            <Alert>{save.error}</Alert>
            <Button variant="primary" size="large" busy={save.busy} onClick={submit} disabled={!form.title || range[1] - range[0] < 10 || !planOk}>
              Podcast erstellen
            </Button>
            <small>Das Audio wird im Hintergrund geladen, geschnitten und hochgeladen. Den Fortschritt siehst du in der Podcast-Übersicht.</small>
          </div>
        )}
      </Card>

      {pickEvent && (
        <Modal title="Plan auswählen" wide onClose={() => setPickEvent(false)}>
          <EventPicker
            tool="podcast"
            defaultRange="past"
            value={prepared?.eventId ?? null}
            onChange={(ev: PlanningEvent) => {
              setPickEvent(false);
              void load(ev.id);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function TimeBox({ label, value, onChange }: { label: string; value: number; onChange: (sec: number) => void }) {
  const [text, setText] = useState(fmtDuration(value));
  useEffect(() => setText(fmtDuration(value)), [value]);
  return (
    <div className="field">
      <span className="label">{label}</span>
      <input
        className="time-input"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const sec = parseDuration(text);
          if (sec === null) setText(fmtDuration(value));
          else onChange(sec);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

/** Dateiauswahl für ein PDF */
export function PdfInput({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <label className="btn small" style={{ cursor: 'pointer' }}>
        <FileText size={15} /> {file ? 'Andere Datei' : 'PDF wählen'}
        <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </label>
      {file && (
        <>
          <small style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</small>
          <Button size="small" variant="ghost" onClick={() => onChange(null)}>
            Entfernen
          </Button>
        </>
      )}
    </div>
  );
}
