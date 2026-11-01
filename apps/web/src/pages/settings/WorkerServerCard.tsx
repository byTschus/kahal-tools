import { Play, RefreshCw, Server, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, ConfirmButton, Field, Spinner } from '../../components/ui';
import { api, useAction, useApi } from '../../lib/api';
import { fmtDate } from '../../lib/format';

interface ServerInfo {
  id: string;
  name: string;
  status: string;
  taskState: string | null;
}

interface WorkerServerData {
  configured: boolean;
  defaults: { authUrl: string };
  config?: {
    authUrl: string;
    region: string | null;
    appCredId: string;
    serverId: string;
    serverName: string | null;
    autoStart: boolean;
    autoStop: boolean;
    idleMinutes: number;
    state?: { lastStartAt?: string | null; lastStopAt?: string | null; lastError?: string | null; lastErrorAt?: string | null };
  };
  server?: ServerInfo | null;
  error?: string | null;
}

function statusBadge(s: ServerInfo) {
  if (s.taskState === 'powering-on' || s.taskState === 'unshelving' || s.status === 'BUILD') return <Badge color="yellow">Startet …</Badge>;
  if (s.taskState === 'powering-off' || s.taskState?.startsWith('shelving')) return <Badge color="yellow">Fährt herunter …</Badge>;
  if (s.status === 'ACTIVE') return <Badge color="green">Läuft</Badge>;
  if (s.status === 'SHUTOFF' || s.status.startsWith('SHELVED')) return <Badge>Gestoppt</Badge>;
  return <Badge color="red">{s.status}</Badge>;
}

export function WorkerServerCard() {
  const { data, loading, reload } = useApi<WorkerServerData>('/api/worker-server');
  const [form, setForm] = useState({ authUrl: '', region: '', appCredId: '', appCredSecret: '', serverId: '', autoStart: true, autoStop: true, idleMinutes: 15 });
  const [servers, setServers] = useState<ServerInfo[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useAction();
  const save = useAction();
  const power = useAction();

  useEffect(() => {
    if (!data) return;
    const c = data.config;
    setForm({
      authUrl: c?.authUrl ?? data.defaults.authUrl,
      region: c?.region ?? '',
      appCredId: c?.appCredId ?? '',
      appCredSecret: '',
      serverId: c?.serverId ?? '',
      autoStart: c?.autoStart ?? true,
      autoStop: c?.autoStop ?? true,
      idleMinutes: c?.idleMinutes ?? 15,
    });
    if (c) setServers([{ id: c.serverId, name: c.serverName ?? c.serverId, status: '', taskState: null }]);
    setEditing(!data.configured);
  }, [data]);

  // Während der Server startet oder herunterfährt, Status regelmässig aktualisieren
  const transitional = Boolean(data?.server?.taskState) || data?.server?.status === 'BUILD';
  useEffect(() => {
    if (!transitional) return;
    const t = setInterval(() => void reload(), 8000);
    return () => clearInterval(t);
  }, [transitional, reload]);

  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });
  const creds = { authUrl: form.authUrl, region: form.region || null, appCredId: form.appCredId, appCredSecret: form.appCredSecret || undefined };
  const state = data.config?.state;

  const loadServers = async () => {
    const list = await load.run(() => api.post<ServerInfo[]>('/api/worker-server/servers', creds));
    if (list) {
      setServers(list);
      if (!list.some((s) => s.id === form.serverId)) set('serverId', list[0]?.id ?? '');
    }
  };

  const submit = async () => {
    setMessage(null);
    const ok = await save.run(() => api.put('/api/worker-server', { ...creds, serverId: form.serverId, autoStart: form.autoStart, autoStop: form.autoStop, idleMinutes: form.idleMinutes }));
    if (ok) {
      setMessage('Gespeichert.');
      void reload();
    }
  };

  const doPower = async (action: 'start' | 'stop') => {
    setMessage(null);
    const res = await power.run(() => api.post<{ changed: boolean }>(`/api/worker-server/${action}`));
    if (res) {
      if (!res.changed) setMessage(action === 'start' ? 'Der Server läuft bereits.' : 'Der Server ist bereits gestoppt.');
      void reload();
    }
  };

  return (
    <Card
      title="Worker-Server"
      actions={
        data.configured && (
          <ConfirmButton
            question="Worker-Server-Verbindung entfernen? Der Server selbst wird nicht gelöscht und bleibt im aktuellen Zustand."
            onConfirm={async () => {
              await api.del('/api/worker-server');
              void reload();
            }}
          >
            Entfernen
          </ConfirmButton>
        )
      }
    >
      <p className="muted">
        Optional: kahal.tools startet den Cloud-Server für die Podcast-Verarbeitung nur, wenn Aufträge anstehen, und fährt ihn danach wieder herunter. Gestoppte
        Instanzen kosten bei Infomaniak nur noch den Speicher.
      </p>

      {data.configured && data.config && (
        <div className="row between" style={{ padding: '8px 0 12px' }}>
          <div className="row">
            <Server size={18} />
            <div>
              <div className="row" style={{ gap: 8 }}>
                <b>{data.config.serverName ?? data.config.serverId}</b>
                {data.server && statusBadge(data.server)}
              </div>
              <small className="muted">
                {state?.lastStartAt && <>Zuletzt gestartet {fmtDate(state.lastStartAt)}</>}
                {state?.lastStartAt && state?.lastStopAt && ' · '}
                {state?.lastStopAt && <>gestoppt {fmtDate(state.lastStopAt)}</>}
              </small>
            </div>
          </div>
          <div className="row">
            <Button size="small" variant="ghost" icon={RefreshCw} onClick={() => void reload()} title="Aktualisieren" aria-label="Aktualisieren" />
            <Button size="small" icon={Play} busy={power.busy} onClick={() => doPower('start')} disabled={data.server?.status === 'ACTIVE'}>
              Starten
            </Button>
            <Button size="small" icon={Square} busy={power.busy} onClick={() => doPower('stop')} disabled={data.server?.status !== 'ACTIVE'}>
              Stoppen
            </Button>
            {!editing && (
              <Button size="small" onClick={() => setEditing(true)}>
                Bearbeiten
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="stack">
        <Alert>{data.error ?? power.error}</Alert>
        {state?.lastError && <Alert kind="warning">Letzter Fehler beim automatischen Starten/Stoppen ({fmtDate(state.lastErrorAt)}): {state.lastError}</Alert>}
        {message && <Alert kind="success">{message}</Alert>}
      </div>

      {editing && (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="grid grid-2">
            <Field label="Auth-URL" hint="Infomaniak: pub1 oder pub2, siehe „API-Zugang“ im Cloud-Dashboard">
              <input type="text" value={form.authUrl} onChange={(e) => set('authUrl', e.target.value)} />
            </Field>
            <Field label="Region" hint="Leer = automatisch (z.B. dc3-a)">
              <input type="text" value={form.region} placeholder="automatisch" onChange={(e) => set('region', e.target.value)} />
            </Field>
            <Field label="Application Credential ID">
              <input type="text" value={form.appCredId} autoComplete="off" onChange={(e) => set('appCredId', e.target.value)} />
            </Field>
            <Field label="Application Credential Secret">
              <input
                type="password"
                value={form.appCredSecret}
                autoComplete="new-password"
                placeholder={data.configured ? '•••••••• (unverändert)' : ''}
                onChange={(e) => set('appCredSecret', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Button busy={load.busy} onClick={loadServers} disabled={!form.appCredId}>
              Server laden
            </Button>
          </div>
          <Alert>{load.error ?? save.error}</Alert>
          {servers && (
            <>
              <Field label="Server">
                <select value={form.serverId} onChange={(e) => set('serverId', e.target.value)}>
                  {servers.length === 0 && <option value="">Keine Server im Projekt gefunden</option>}
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.status ? ` (${s.status})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-2">
                <div className="stack" style={{ justifyContent: 'center' }}>
                  <Checkbox checked={form.autoStart} onChange={(v) => set('autoStart', v)} label="Automatisch starten, wenn Aufträge anstehen" />
                  <Checkbox checked={form.autoStop} onChange={(v) => set('autoStop', v)} label="Automatisch herunterfahren, wenn nichts zu tun ist" />
                </div>
                <Field label="Herunterfahren nach (Minuten ohne Auftrag)">
                  <input type="number" min={5} max={1440} value={form.idleMinutes} disabled={!form.autoStop} onChange={(e) => set('idleMinutes', Number(e.target.value))} />
                </Field>
              </div>
              <div className="row">
                <Button variant="primary" busy={save.busy} onClick={submit} disabled={!form.serverId}>
                  Speichern
                </Button>
                {data.configured && (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Abbrechen
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
