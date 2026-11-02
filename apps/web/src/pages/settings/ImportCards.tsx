import { CalendarCheck, Download, FileUp, Search } from 'lucide-react';
import { useState } from 'react';
import { FeedImportModal, VisitorImportModal } from '../../components/ImportModals';
import { MatchingInfo, PlanMatchBadge, type MatchedPlan, type MatchingSummary } from '../../components/PlanMatch';
import { Alert, Button, Card } from '../../components/ui';
import { api, useAction } from '../../lib/api';
import { fmtDate } from '../../lib/format';

/** Besucherzahlen aus CSV/Excel importieren */
export function VisitorImportCard() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card title="Besucherzahlen importieren">
      <p className="muted">Bisherige Zahlen aus einer CSV- oder Excel-Datei übernehmen. Neue Einträge können dabei automatisch einem Plan zugeordnet werden.</p>
      <Alert kind="success">{message}</Alert>
      <div>
        <Button icon={FileUp} onClick={() => setOpen(true)}>
          Datei importieren
        </Button>
      </div>
      {open && (
        <VisitorImportModal
          onClose={() => setOpen(false)}
          onDone={(text) => {
            setOpen(false);
            setMessage(text);
          }}
        />
      )}
    </Card>
  );
}

/** Episoden eines bestehenden RSS-Feeds importieren */
export function FeedImportCard() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card title="Bestehenden Podcast importieren">
      <p className="muted">
        Episoden eines bisherigen RSS-Feeds übernehmen. Die Audiodateien bleiben beim bisherigen Anbieter. Neue Episoden können dabei automatisch einem Plan
        zugeordnet werden.
      </p>
      <Alert kind="success">{message}</Alert>
      <div>
        <Button icon={Download} onClick={() => setOpen(true)}>
          Feed importieren
        </Button>
      </div>
      {open && (
        <FeedImportModal
          onClose={() => setOpen(false)}
          onDone={(text) => {
            setOpen(false);
            setMessage(text);
          }}
        />
      )}
    </Card>
  );
}

interface LivestreamMatchPreview {
  total: number;
  withPlan: number;
  open: number;
  matching: MatchingSummary;
  rows: { id: string; title: string; date: string | null; url: string; plan: MatchedPlan | null; ambiguous: boolean }[];
}

/** Vergangene Livestreams ohne Plan automatisch einem Plan zuordnen */
export function LivestreamPlanMatchCard() {
  const [preview, setPreview] = useState<LivestreamMatchPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useAction();
  const run = useAction();

  const check = async () => {
    setPreview(null);
    setMessage(null);
    const res = await load.run(() => api.post<LivestreamMatchPreview>('/api/livestreams/match-plans', {}));
    if (res) setPreview(res);
  };

  const commit = async () => {
    const res = await run.run(() => api.post<{ linked: number; matchError?: string }>('/api/livestreams/match-plans', { commit: true }));
    if (!res) return;
    setPreview(null);
    setMessage(res.matchError ?? `${res.linked} Livestreams wurden einem Plan zugeordnet.`);
  };

  return (
    <Card title="Livestreams Plänen zuordnen">
      <p className="muted">
        Sucht vergangene Livestreams ohne Plan (z.B. direkt auf YouTube erstellte) und ordnet sie anhand der Startzeit dem passenden Plan zu; der Titel hilft bei
        Abweichungen. Nicht eindeutige Fälle bleiben frei, sie lassen sich in der Livestream-Liste von Hand verknüpfen.
      </p>
      <Alert kind="success">{message}</Alert>
      <Alert>{load.error ?? run.error}</Alert>
      <div className="row">
        <Button icon={Search} busy={load.busy} onClick={check}>
          {preview ? 'Erneut prüfen' : 'Livestreams prüfen'}
        </Button>
        {preview && preview.matching.linked > 0 && (
          <Button variant="primary" icon={CalendarCheck} busy={run.busy} onClick={commit}>
            {preview.matching.linked} Livestreams zuordnen
          </Button>
        )}
      </div>
      {preview && (
        <div className="stack">
          <div>
            {preview.total} vergangene Livestreams, davon {preview.withPlan} bereits mit Plan.
          </div>
          {preview.open > 0 && <MatchingInfo matching={preview.matching} total={preview.open} />}
          {preview.open > 0 && !preview.matching.error && (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Start</th>
                    <th>Livestream</th>
                    <th>Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                      <td>
                        <a className="title-link" href={r.url} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      </td>
                      <td style={{ maxWidth: 280 }}>
                        <PlanMatchBadge plan={r.plan} ambiguous={r.ambiguous} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
