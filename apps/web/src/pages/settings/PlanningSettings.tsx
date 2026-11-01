import { CopyField } from '../../components/CopyField';
import { OAuthAppCard, type OAuthAppStatus } from '../../components/OAuthAppCard';
import { Alert, Button, Card, Checkbox, Field, Spinner , Saved } from '../../components/ui';
import { useApi } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { useSettings } from './useSettings';

export function PlanningSettings() {
  const { me } = useMe();
  const { data: sources, loading: loadingSources, error: sourcesError } = useApi<{ id: string; name: string }[]>('/api/planning/sources');
  const s = useSettings<{ sourceIds: string[] }>('planning');
  const { data: apps, reload: reloadApps } = useApi<{ pco: OAuthAppStatus; loginUrl: string }>('/api/oauth-apps');

  return (
    <>
      <Card title="Verknüpftes Planungstool">
        <p>
          Gemeinde <b>{me.tenant.name}</b> ist mit <b>{me.tenant.provider === 'pco' ? 'Planning Center' : me.tenant.provider}</b> verknüpft. Alle Benutzer melden
          sich mit ihrem Planungstool-Konto an und sehen nur die Pläne, auf die sie dort Zugriff haben.
        </p>
        <small>Zeitzone: {me.tenant.timeZone}</small>
        {apps && (
          <div style={{ marginTop: 12 }}>
            <Field label="Login-Link der Gemeinde" hint="Diesen Link an alle Mitarbeitenden weitergeben (z.B. als Lesezeichen).">
              <CopyField value={apps.loginUrl} />
            </Field>
          </div>
        )}
      </Card>
      {apps && me.tenant.provider === 'pco' && (
        <OAuthAppCard
          provider="pco"
          title="Planning Center API-Zugangsdaten"
          status={apps.pco}
          onChanged={reloadApps}
          warning="Nach einer Änderung müssen sich alle Benutzer einmal neu anmelden."
          instructions={
            <ol style={{ paddingLeft: 20, margin: 0 }}>
              <li>
                <a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noreferrer">
                  api.planningcenteronline.com/oauth/applications
                </a>{' '}
                öffnen → „New Application“.
              </li>
              <li>Die Redirect-URL unten als Callback-URL eintragen.</li>
              <li>Client ID und Secret hier eintragen und speichern.</li>
            </ol>
          }
        />
      )}
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
              <Saved show={s.saved} />
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
