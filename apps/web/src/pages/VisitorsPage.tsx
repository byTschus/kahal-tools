import { Download, FileUp, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart } from '../components/BarChart';
import { EventPicker } from '../components/EventPicker';
import { PlanLink } from '../components/PlanLink';
import { MATCH_LABEL, MatchingInfo, PlanMatchBadge, type MatchedPlan, type MatchingSummary } from '../components/PlanMatch';
import { Alert, Badge, Button, Card, Checkbox, ConfirmButton, Empty, Field, Modal, PageHeader, Spinner, Tabs } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { useCan } from '../lib/auth';
import { fmtDate, fmtNumber, fromLocalInput, isoDate, toLocalInput } from '../lib/format';
import type { PlanningEvent, VisitorCount, VisitorLocation } from '../lib/types';

interface Stats {
  summary: {
    events: number;
    onSite: number;
    livestream: number;
    total: number;
    avgOnSite: number;
    avgLivestream: number;
    avgTotal: number;
    maxEvent: { title: string; date: string; total: number } | null;
  };
  perLocation: { id: string; name: string; active: boolean; sum: number; avg: number; max: number; entries: number }[];
  perMonth: { month: string; events: number; onSite: number; livestream: number; total: number; avgOnSite: number; avgTotal: number }[];
  events: { id: string; date: string; title: string; onSite: number; livestream: number; total: number; values: Record<string, number> }[];
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-6)'];
const LIVESTREAM_COLOR = 'var(--chart-5)';

export function VisitorsPage() {
  const can = useCan();
  const [tab, setTab] = useState<'list' | 'stats'>('list');
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 365 * 86400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const query = `from=${from}T00:00:00Z&to=${to}T23:59:59Z`;
  const { data: locations } = useApi<VisitorLocation[]>('/api/visitors/locations');
  const { data: counts, loading, error, reload } = useApi<VisitorCount[]>(`/api/visitors/counts?${query}`);
  const [editing, setEditing] = useState<VisitorCount | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const usedLocationIds = new Set(counts?.flatMap((c) => c.values.map((v) => v.locationId)));
  const columns = (locations ?? []).filter((l) => l.active || usedLocationIds.has(l.id));

  return (
    <>
      <PageHeader title="Besucherzähler" description="Besucher vor Ort und im Livestream erfassen und auswerten.">
        <a className="btn" href={`/api/visitors/export.xlsx?${query}`}>
          <Download size={16} /> Excel
        </a>
        {can('visitors', 'create') && (
          <Button icon={FileUp} onClick={() => setImporting(true)}>
            Importieren
          </Button>
        )}
        {can('visitors', 'create') && (
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            Besucher erfassen
          </Button>
        )}
      </PageHeader>
      <Alert kind="success">{message}</Alert>
      {locations && locations.length === 0 && (
        <Alert kind="warning">
          Es sind noch keine Orte definiert. <Link to="/settings/visitors">In den Einstellungen Orte anlegen</Link>
        </Alert>
      )}
      <Card>
        <div className="row between">
          <Tabs
            tabs={[
              { key: 'list', label: 'Erfassungen' },
              { key: 'stats', label: 'Statistik' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="row">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            <span>–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </div>
        </div>
        {tab === 'list' ? (
          error ? (
            <Alert>{error.message}</Alert>
          ) : loading && !counts ? (
            <Spinner />
          ) : !counts?.length ? (
            <Empty icon={Users} title="Keine Erfassungen">Im gewählten Zeitraum wurden keine Besucher erfasst.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Event</th>
                    {columns.map((l) => (
                      <th key={l.id} className="num">
                        {l.name}
                      </th>
                    ))}
                    <th className="num">Livestream</th>
                    <th className="num">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {counts.map((c) => {
                    const onSite = c.values.reduce((s, v) => s + v.value, 0);
                    const ls = c.livestreamEnabled ? (c.livestreamCount ?? 0) : 0;
                    return (
                      <tr key={c.id}>
                        <td>{fmtDate(c.eventDate)}</td>
                        <td>
                          <div className="cell-title">{c.eventTitle}</div>
                          {c.notes && <div className="cell-sub">{c.notes}</div>}
                          {c.imported && !c.planId && <Badge plain>Importiert</Badge>}
                        </td>
                        {columns.map((l) => (
                          <td key={l.id} className="num">
                            {fmtNumber(c.values.find((v) => v.locationId === l.id)?.value)}
                          </td>
                        ))}
                        <td className="num" title={c.livestreamMode === 'views' ? 'Aufrufe' : 'Gleichzeitige Zuschauer'}>
                          {c.livestreamEnabled ? fmtNumber(c.livestreamCount) : '–'}
                        </td>
                        <td className="num">
                          <b>{fmtNumber(onSite + ls)}</b>
                        </td>
                        <td>
                          <div className="actions">
                            {can('visitors', 'edit') && (
                              <Button size="small" icon={Pencil} title="Bearbeiten" aria-label="Bearbeiten" onClick={() => setEditing(c)} />
                            )}
                            {can('visitors', 'delete') && (
                              <ConfirmButton
                                icon={Trash2}
                                title="Löschen"
                                aria-label="Löschen"
                                question={`Erfassung „${c.eventTitle}“ löschen?`}
                                onConfirm={async () => {
                                  await api.del(`/api/visitors/counts/${c.id}`);
                                  void reload();
                                }}
                              >
                                {null}
                              </ConfirmButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <StatsView query={query} />
        )}
      </Card>
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onDone={(text) => {
            setImporting(false);
            setMessage(text);
            void reload();
          }}
        />
      )}
      {editing && locations && (
        <CountModal
          count={editing === 'new' ? null : editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

function StatsView({ query }: { query: string }) {
  const { data, loading, error } = useApi<Stats>(`/api/visitors/stats?${query}`);
  const series = useMemo(
    () => [
      ...(data?.perLocation ?? []).filter((l) => l.entries > 0).map((l, i) => ({ key: l.id, label: l.name, color: COLORS[i % COLORS.length] })),
      { key: 'livestream', label: 'Livestream', color: LIVESTREAM_COLOR },
    ],
    [data],
  );
  if (error) return <Alert>{error.message}</Alert>;
  if (loading || !data) return <Spinner />;
  const s = data.summary;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid grid-4">
        <Stat label="Events" value={fmtNumber(s.events)} />
        <Stat label="Ø vor Ort" value={fmtNumber(s.avgOnSite)} />
        <Stat label="Ø Livestream" value={fmtNumber(s.avgLivestream)} />
        <Stat label="Ø Total" value={fmtNumber(s.avgTotal)} />
        <Stat label="Total Besuche" value={fmtNumber(s.total)} />
        {s.maxEvent && <Stat label={`Höchstwert (${fmtDate(s.maxEvent.date, false)})`} value={fmtNumber(s.maxEvent.total)} />}
      </div>
      <div>
        <h3>Besucher pro Event</h3>
        <BarChart
          series={series}
          data={data.events.map((e) => ({
            label: new Date(e.date).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            values: { ...e.values, livestream: e.livestream },
          }))}
        />
      </div>
      <div className="grid grid-2">
        <div>
          <h3>Pro Ort</h3>
          <table>
            <thead>
              <tr>
                <th>Ort</th>
                <th className="num">Ø</th>
                <th className="num">Max.</th>
                <th className="num">Summe</th>
              </tr>
            </thead>
            <tbody>
              {data.perLocation.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.name} {!l.active && <small>(inaktiv)</small>}
                  </td>
                  <td className="num">{fmtNumber(l.avg)}</td>
                  <td className="num">{fmtNumber(l.max)}</td>
                  <td className="num">{fmtNumber(l.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Pro Monat</h3>
          <table>
            <thead>
              <tr>
                <th>Monat</th>
                <th className="num">Events</th>
                <th className="num">Ø vor Ort</th>
                <th className="num">Ø Total</th>
              </tr>
            </thead>
            <tbody>
              {data.perMonth.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{m.events}</td>
                  <td className="num">{fmtNumber(m.avgOnSite)}</td>
                  <td className="num">{fmtNumber(m.avgTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function CountModal({ count, locations, onClose, onSaved }: { count: VisitorCount | null; locations: VisitorLocation[]; onClose: () => void; onSaved: () => void }) {
  const { data: settings } = useApi<{ livestreamEnabled: boolean; livestreamMode: 'concurrent' | 'views' }>('/api/settings/visitors');
  const [step, setStep] = useState<'event' | 'form'>(count ? 'form' : 'event');
  const [eventId, setEventId] = useState<string | null>(count?.planId ?? null);
  const [planTitle, setPlanTitle] = useState<string | null>(null);
  const [title, setTitle] = useState(count?.eventTitle ?? '');
  const [date, setDate] = useState(toLocalInput(count?.eventDate ?? null));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries((count?.values ?? []).map((v) => [v.locationId, String(v.value)])));
  const [lsEnabled, setLsEnabled] = useState(count?.livestreamEnabled ?? false);
  const [lsCount, setLsCount] = useState(count?.livestreamCount != null ? String(count.livestreamCount) : '');
  const [lsVideoId, setLsVideoId] = useState<string | null>(count?.livestreamVideoId ?? null);
  const [lsInfo, setLsInfo] = useState<string | null>(null);
  const [notes, setNotes] = useState(count?.notes ?? '');
  const [showBroadcasts, setShowBroadcasts] = useState(false);
  const save = useAction();
  const ls = useAction();
  const visible = locations.filter((l) => l.active || values[l.id] !== undefined);

  useEffect(() => {
    if (!count && settings) setLsEnabled(settings.livestreamEnabled);
  }, [settings, count]);

  const fetchLivestream = async (opts: { eventId?: string | null; videoId?: string | null }) => {
    const res = await ls.run(() => api.post<{ found: boolean; videoId?: string; count: number | null; message?: string; title?: string }>('/api/visitors/livestream-count', opts));
    if (!res) return;
    if (res.found) {
      setLsVideoId(res.videoId ?? null);
      if (res.count != null) setLsCount(String(res.count));
    }
    setLsInfo(res.message ?? (res.found ? `Wert von YouTube übernommen${res.title ? ` („${res.title}“)` : ''}` : null));
  };

  const chooseEvent = (ev: PlanningEvent) => {
    setEventId(ev.id);
    setTitle(ev.title);
    setDate(toLocalInput(ev.startsAt));
    setStep('form');
    if (lsEnabled || settings?.livestreamEnabled) void fetchLivestream({ eventId: ev.id });
  };

  const submit = async () => {
    const body = {
      eventId,
      eventTitle: title,
      eventDate: fromLocalInput(date),
      values: Object.entries(values)
        .filter(([, v]) => v !== '')
        .map(([locationId, v]) => ({ locationId, value: Math.max(0, Math.round(Number(v))) })),
      livestreamEnabled: lsEnabled,
      livestreamMode: settings?.livestreamMode ?? 'concurrent',
      livestreamVideoId: lsVideoId,
      livestreamCount: lsCount === '' ? null : Math.round(Number(lsCount)),
      notes: notes || null,
    };
    const ok = await save.run(() => (count ? api.patch(`/api/visitors/counts/${count.id}`, body) : api.post('/api/visitors/counts', body)));
    if (ok) onSaved();
  };

  const onSiteTotal = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <Modal
      title={count ? 'Erfassung bearbeiten' : 'Besucher erfassen'}
      onClose={onClose}
      wide={step === 'event'}
      footer={
        step === 'form' ? (
          <>
            {!count && <Button onClick={() => setStep('event')}>Anderer Plan</Button>}
            <Button variant="primary" busy={save.busy} onClick={submit} disabled={!title || !date || (!count && !eventId)}>
              Speichern
            </Button>
          </>
        ) : null
      }
    >
      {step === 'event' ? (
        <>
          <p className="muted">Wähle den Plan, zu dem die Besucherzahlen gehören. Jeder Plan kann nur einmal erfasst werden.</p>
          <EventPicker tool="visitors" ownId={count?.id} defaultRange="past" value={eventId} onChange={chooseEvent} />
        </>
      ) : (
        <>
          <Alert>{save.error}</Alert>
          {count && (
            <Field label="Plan" hint="Titel und Datum der Erfassung bleiben beim Verknüpfen unverändert">
              <PlanLink
                tool="visitors"
                ownId={count.id}
                value={eventId ? { id: eventId, title: eventId === count.planId ? count.eventTitle : planTitle } : null}
                onChange={(plan) => {
                  setEventId(plan?.id ?? null);
                  setPlanTitle(plan?.title ?? null);
                }}
              />
            </Field>
          )}
          <div className="grid grid-2">
            <Field label="Event">
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Datum / Zeit">
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-3">
            {visible.map((l) => (
              <Field key={l.id} label={l.name}>
                <input type="number" min={0} inputMode="numeric" value={values[l.id] ?? ''} onChange={(e) => setValues({ ...values, [l.id]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="muted">Vor Ort total: <b>{onSiteTotal}</b></div>
          <div className="card-subtle">
            <Checkbox
              checked={lsEnabled}
              onChange={(v) => {
                setLsEnabled(v);
                if (v && !lsCount && eventId) void fetchLivestream({ eventId });
              }}
              label={<b>Livestream ({settings?.livestreamMode === 'views' ? 'Aufrufe' : 'gleichzeitige Zuschauer'})</b>}
            />
            {lsEnabled && (
              <div className="stack" style={{ marginTop: 10 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="number" min={0} value={lsCount} onChange={(e) => setLsCount(e.target.value)} style={{ maxWidth: 140 }} />
                  <Button size="small" icon={RefreshCw} busy={ls.busy} onClick={() => fetchLivestream({ eventId, videoId: lsVideoId })} disabled={!eventId && !lsVideoId}>
                    Von YouTube lesen
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => setShowBroadcasts((s) => !s)}>
                    Stream wählen
                  </Button>
                </div>
                {(lsInfo || ls.error) && <small>{ls.error ?? lsInfo}</small>}
                {showBroadcasts && (
                  <BroadcastSelect
                    value={lsVideoId}
                    onChange={(id) => {
                      setShowBroadcasts(false);
                      void fetchLivestream({ videoId: id });
                    }}
                  />
                )}
              </div>
            )}
          </div>
          <Field label="Notizen">
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  );
}

function BroadcastSelect({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const { data, loading } = useApi<{ id: string; title: string; date: string | null }[]>('/api/visitors/broadcasts');
  if (loading) return <Spinner />;
  return (
    <div className="scroll-list" style={{ maxHeight: 220 }}>
      {(data ?? []).map((b) => (
        <button key={b.id} type="button" className={`list-item ${value === b.id ? 'selected' : ''}`} onClick={() => onChange(b.id)}>
          <div>
            <div style={{ fontWeight: 600 }}>{b.title}</div>
            <small>{fmtDate(b.date)}</small>
          </div>
        </button>
      ))}
    </div>
  );
}

interface ImportPreview {
  columns: { header: string; kind: 'date' | 'time' | 'title' | 'livestream' | 'notes' | 'total' | 'location' | 'newLocation' | 'ignored' }[];
  total: number;
  duplicates: number;
  errors: { line: number; message: string }[];
  sample: { line: number; date: string; title: string; values: Record<string, number>; livestream: number | null; duplicate: boolean }[];
  matching?: MatchingSummary & { rows: { line: number; date: string; title: string; plan: MatchedPlan | null; ambiguous: boolean }[] };
}

const KIND_LABEL: Record<ImportPreview['columns'][number]['kind'], string> = {
  date: 'Datum',
  time: 'Uhrzeit',
  title: 'Titel',
  livestream: 'Livestream',
  notes: 'Bemerkung',
  total: 'Total (wird berechnet)',
  location: 'Ort',
  newLocation: 'Neuer Ort',
  ignored: 'Wird ignoriert',
};

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [createLocations, setCreateLocations] = useState(true);
  const [matchPlans, setMatchPlans] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const load = useAction();
  const run = useAction();
  const url = (commit: boolean) =>
    `/api/visitors/import?fileName=${encodeURIComponent(file?.name ?? '')}&createLocations=${createLocations}&matchPlans=${matchPlans}${commit ? '&commit=true' : ''}`;

  useEffect(() => {
    if (!file) return;
    setPreview(null);
    void load.run(() => api.upload<ImportPreview>(url(false), file)).then((res) => res && setPreview(res));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, createLocations, matchPlans]);

  const commit = async () => {
    if (!file) return;
    const res = await run.run(() => api.upload<{ imported: number; skipped: number; linked: number; matchError?: string }>(url(true), file));
    if (res)
      onDone(
        `${res.imported} Erfassungen importiert${res.linked ? `, ${res.linked} davon einem Plan zugeordnet` : ''}${res.skipped ? `, ${res.skipped} bereits vorhanden und übersprungen` : ''}.${res.matchError ? ` ${res.matchError}` : ''}`,
      );
  };

  const importable = preview ? preview.total - preview.duplicates : 0;

  return (
    <Modal
      title="Besucherzahlen importieren"
      wide
      onClose={onClose}
      footer={
        preview ? (
          <Button variant="primary" busy={run.busy} disabled={!importable} onClick={commit}>
            {importable} Erfassungen importieren
          </Button>
        ) : null
      }
    >
      <p className="muted">
        CSV- oder Excel-Datei (.xlsx) mit einer Zeile pro Gottesdienst. Erste Zeile = Überschriften: <b>Datum</b> (Pflicht), optional <b>Uhrzeit</b>, <b>Titel</b>,{' '}
        <b>Livestream</b> und <b>Bemerkung</b>. Alle weiteren Spalten sind Orte, z.B. „Saal EG“. Ohne Uhrzeit wird 10:00 angenommen. Neue Einträge können automatisch
        dem Plan vom selben Tag zugeordnet werden; fehlen Uhrzeit oder Titel in der Datei, werden sie aus dem Plan übernommen.
      </p>
      <code style={{ display: 'block', fontSize: '0.8rem', padding: 10, background: 'var(--surface-2)', borderRadius: 8, whiteSpace: 'pre', overflowX: 'auto' }}>
        {'Datum;Titel;Saal EG;Kinderprogramm;Livestream\n05.01.2025;Gottesdienst;142;31;58'}
      </code>
      <div className="row">
        <label className="btn" style={{ cursor: 'pointer' }}>
          <FileUp size={16} /> {file ? 'Andere Datei' : 'Datei wählen'}
          <input type="file" accept=".csv,.txt,.xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && <small>{file.name}</small>}
      </div>
      <Checkbox checked={createLocations} onChange={setCreateLocations} label="Unbekannte Spalten als neue Orte anlegen" />
      <Checkbox checked={matchPlans} onChange={setMatchPlans} label={MATCH_LABEL} />
      <Alert>{load.error ?? run.error}</Alert>
      {load.busy && <Spinner label="Datei wird geprüft …" />}
      {preview && (
        <div className="stack">
          <div className="row" style={{ gap: 6 }}>
            {preview.columns
              .filter((c) => c.header)
              .map((c) => (
                <Badge key={c.header} color={c.kind === 'ignored' ? undefined : c.kind === 'newLocation' ? 'blue' : 'green'} plain>
                  {c.header}: {KIND_LABEL[c.kind]}
                </Badge>
              ))}
          </div>
          <div>
            {preview.total} Zeilen erkannt{preview.duplicates ? `, davon ${preview.duplicates} bereits vorhanden` : ''}.
          </div>
          {preview.errors.length > 0 && (
            <Alert kind="warning">
              {preview.errors.slice(0, 5).map((e) => (
                <div key={e.line}>
                  Zeile {e.line}: {e.message}
                </div>
              ))}
              {preview.errors.length > 5 && <div>… und {preview.errors.length - 5} weitere</div>}
            </Alert>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Titel</th>
                  <th>Werte</th>
                  <th className="num">Livestream</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r) => (
                  <tr key={r.line} style={r.duplicate ? { opacity: 0.5 } : undefined}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.title}</td>
                    <td>
                      <small>
                        {Object.entries(r.values)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(', ')}
                      </small>
                    </td>
                    <td className="num">{fmtNumber(r.livestream)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.matching && importable > 0 && (
            <>
              <MatchingInfo matching={preview.matching} total={importable} />
              {!preview.matching.error && (
                <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th>Titel</th>
                        <th>Plan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.matching.rows.map((r) => (
                        <tr key={r.line}>
                          <td>{fmtDate(r.date)}</td>
                          <td>{r.title}</td>
                          <td style={{ maxWidth: 280 }}>
                            <PlanMatchBadge plan={r.plan} ambiguous={r.ambiguous} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
