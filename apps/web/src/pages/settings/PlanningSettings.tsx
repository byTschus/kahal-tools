import { Alert, Button, Card, Checkbox, Spinner } from '../../components/ui';
import { useApi } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { useSettings } from './useSettings';

export function PlanningSettings() {
  const { me } = useMe();
  const { data: sources, loading: loadingSources, error: sourcesError } = useApi<{ id: string; name: string }[]>('/api/planning/sources');
  const s = useSettings<{ sourceIds: string[] }>('planning');

  return (
    <>
      <Card title="Verknüpftes Planungstool">
        <p>
          Gemeinde <b>{me.tenant.name}</b> ist mit <b>{me.tenant.provider === 'pco' ? 'Planning Center' : me.tenant.provider}</b> verknüpft. Alle Benutzer melden
          sich mit ihrem Planungstool-Konto an und sehen nur die Pläne, auf die sie dort Zugriff haben.
        </p>
        <small>Zeitzone: {me.tenant.timeZone}</small>
      </Card>
      <Card title="Berücksichtigte Service Types">
        <p className="muted">Welche Service Types (z.B. „Gottesdienst“, „Jugend“) sollen in den Tools zur Auswahl stehen? Ohne Auswahl werden alle angezeigt.</p>
        <Alert>{sourcesError?.message ?? s.error}</Alert>
        {loadingSources || !s.form ? (
          <Spinner />
        ) : (
          <div className="stack">
            {sources?.map((src) => (
              <Checkbox
                key={src.id}
                checked={s.form!.sourceIds.includes(src.id)}
                onChange={(on) => s.set('sourceIds', on ? [...s.form!.sourceIds, src.id] : s.form!.sourceIds.filter((id) => id !== src.id))}
                label={src.name}
              />
            ))}
            <div className="row">
              <Button variant="primary" busy={s.busy} onClick={s.save}>
                Speichern
              </Button>
              {s.saved && <span className="muted">✓ Gespeichert</span>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
