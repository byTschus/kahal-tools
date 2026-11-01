import { Play, RefreshCw, Server, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card } from '../../components/ui';
import { api, useAction, useApi } from '../../lib/api';
import { fmtDate } from '../../lib/format';

interface ServerInfo {
  id: string;
  name: string;
  status: string;
  taskState: string | null;
}

type WorkerServerStatus =
  | { enabled: false }
  | {
      enabled: true;
      server: ServerInfo | null;
      error: string | null;
      autoStart: boolean;
      autoStop: boolean;
      idleMinutes: number;
      state: { lastStartAt: string; lastStopAt: string | null; lastError: string | null; lastErrorAt: string | null };
    };

function statusBadge(s: ServerInfo) {
  if (s.taskState === 'powering-on' || s.taskState === 'unshelving' || s.status === 'BUILD') return <Badge color="yellow">Startet …</Badge>;
  if (s.taskState === 'powering-off' || s.taskState?.startsWith('shelving')) return <Badge color="yellow">Fährt herunter …</Badge>;
  if (s.status === 'ACTIVE') return <Badge color="green">Läuft</Badge>;
  if (s.status === 'SHUTOFF' || s.status.startsWith('SHELVED')) return <Badge>Gestoppt</Badge>;
  return <Badge color="red">{s.status}</Badge>;
}

/** Status des gemeinsamen Worker-Servers. Erscheint nur, wenn er in der .env des Servers konfiguriert ist. */
export function WorkerServerCard() {
  const { data, reload } = useApi<WorkerServerStatus>('/api/worker-server');
  const [message, setMessage] = useState<string | null>(null);
  const power = useAction();

  // Während der Server startet oder herunterfährt, Status regelmässig aktualisieren
  const server = data?.enabled ? data.server : null;
  const transitional = Boolean(server?.taskState) || server?.status === 'BUILD';
  useEffect(() => {
    if (!transitional) return;
    const t = setInterval(() => void reload(), 8000);
    return () => clearInterval(t);
  }, [transitional, reload]);

  if (!data?.enabled) return null;

  const doPower = async (action: 'start' | 'stop') => {
    setMessage(null);
    const res = await power.run(() => api.post<{ changed: boolean; reason?: string }>(`/api/worker-server/${action}`));
    if (res) {
      if (!res.changed) setMessage(res.reason ?? (action === 'start' ? 'Der Server läuft bereits.' : 'Der Server ist bereits gestoppt.'));
      void reload();
    }
  };

  return (
    <Card title="Worker-Server">
      <p className="muted">
        Der Server für die Podcast-Verarbeitung startet automatisch, wenn Aufträge anstehen
        {data.autoStop ? `, und fährt nach ${data.idleMinutes} Minuten ohne Auftrag wieder herunter` : ''}.
      </p>
      <div className="row between" style={{ paddingTop: 8 }}>
        <div className="row">
          <Server size={18} />
          <div>
            <div className="row" style={{ gap: 8 }}>
              <b>{server?.name ?? 'Worker-Server'}</b>
              {server && statusBadge(server)}
            </div>
            <small className="muted">
              {data.state.lastStopAt ? <>Zuletzt gestoppt {fmtDate(data.state.lastStopAt)}</> : <>Zuletzt gestartet {fmtDate(data.state.lastStartAt)}</>}
            </small>
          </div>
        </div>
        <div className="row">
          <Button size="small" variant="ghost" icon={RefreshCw} onClick={() => void reload()} title="Aktualisieren" aria-label="Aktualisieren" />
          <Button size="small" icon={Play} busy={power.busy} onClick={() => doPower('start')} disabled={!server || server.status === 'ACTIVE'}>
            Starten
          </Button>
          <Button size="small" icon={Square} busy={power.busy} onClick={() => doPower('stop')} disabled={server?.status !== 'ACTIVE'}>
            Stoppen
          </Button>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 8 }}>
        <Alert>{data.error ?? power.error}</Alert>
        {data.state.lastError && <Alert kind="warning">Letzter Fehler beim automatischen Starten/Stoppen ({fmtDate(data.state.lastErrorAt)}): {data.state.lastError}</Alert>}
        {message && <Alert kind="info">{message}</Alert>}
      </div>
    </Card>
  );
}
