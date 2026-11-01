import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart } from '../components/BarChart';
import { EventPicker } from '../components/EventPicker';
import { Alert, Button, Card, Checkbox, ConfirmButton, Empty, Field, Modal, PageHeader, Spinner, Tabs } from '../components/ui';
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

const COLORS = ['#2f5bea', '#18a999', '#f2a541', '#9b5de5', '#e15f74', '#5c9ead', '#7fb800'];
const LIVESTREAM_COLOR = '#d63c3c';

export function VisitorsPage() {
  const can = useCan();
  const [tab, setTab] = useState<'list' | 'stats'>('list');
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 365 * 86400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const query = `from=${from}T00:00:00Z&to=${to}T23:59:59Z`;
  const { data: locations } = useApi<VisitorLocation[]>('/api/visitors/locations');
  const { data: counts, loading, error, reload } = useApi<VisitorCount[]>(`/api/visitors/counts?${query}`);
  const [editing, setEditing] = useState<VisitorCount | 'new' | null>(null);

  const usedLocationIds = new Set(counts?.flatMap((c) => c.values.map((v) => v.locationId)));
  const columns = (locations ?? []).filter((l) => l.active || usedLocationIds.has(l.id));

  return (
    <>
      <PageHeader title="👥 Besucherzähler">
        <a className="btn" href={`/api/visitors/export.xlsx?${query}`}>
          ⬇ Excel
        </a>
        {can('visitors', 'create') && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            ＋ Besucher erfassen
          </Button>
        )}
      </PageHeader>
      {locations && locations.length === 0 && (
        <Alert kind="warning">
          Es sind noch keine Orte definiert. <Link to="/settings/visitors">In den Einstellungen Orte anlegen →</Link>
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
            <Empty>Keine Erfassungen im gewählten Zeitraum.</Empty>
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
                          {c.eventTitle}
                          {c.notes && <div><small>{c.notes}</small></div>}
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
                              <Button size="small" onClick={() => setEditing(c)}>
                                Bearbeiten
                              </Button>
                            )}
                            {can('visitors', 'delete') && (
                              <ConfirmButton
                                question={`Erfassung „${c.eventTitle}“ löschen?`}
                                onConfirm={async () => {
                                  await api.del(`/api/visitors/counts/${c.id}`);
                                  void reload();
                                }}
                              />
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
            <Button onClick={() => setStep('event')}>Event wählen</Button>
            <Button variant="primary" busy={save.busy} onClick={submit} disabled={!title || !date}>
              Speichern
            </Button>
          </>
        ) : (
          <Button onClick={() => setStep('form')}>Ohne Plan manuell erfassen</Button>
        )
      }
    >
      {step === 'event' ? (
        <EventPicker defaultRange="past" value={eventId} onChange={chooseEvent} />
      ) : (
        <>
          <Alert>{save.error}</Alert>
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
          <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
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
                  <Button size="small" busy={ls.busy} onClick={() => fetchLivestream({ eventId, videoId: lsVideoId })} disabled={!eventId && !lsVideoId}>
                    ↻ Von YouTube lesen
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
