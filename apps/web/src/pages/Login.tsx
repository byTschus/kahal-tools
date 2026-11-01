import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { api, useApi } from '../lib/api';
import type { Me } from '../lib/types';

export function LoginPage() {
  const [params] = useSearchParams();
  const { data: providers, loading } = useApi<{ key: string; label: string }[]>('/auth/providers');

  return (
    <div className="login-page">
      <Card className="login-card">
        <img src="/favicon.svg" alt="" />
        <h1>kahal.tools</h1>
        <p className="muted">Technik-Tools für deine Gemeinde: Livestream, Podcast, Besucherzähler.</p>
        <Alert>{params.get('error')}</Alert>
        <div className="stack" style={{ marginTop: 20 }}>
          {loading && <Spinner />}
          {providers?.map((p) => (
            <a key={p.key} className={`btn large block ${p.key === 'mock' ? '' : 'primary'}`} href={`/auth/${p.key}/login`}>
              Mit {p.label} anmelden
            </a>
          ))}
          {providers && providers.length === 0 && (
            <Alert kind="warning">Es ist noch kein Planungstool konfiguriert. Siehe docs/SETUP.md (PCO_CLIENT_ID / PCO_CLIENT_SECRET).</Alert>
          )}
        </div>
        <p className="muted" style={{ marginTop: 24, fontSize: '0.85rem' }}>
          Deine Gemeinde wird automatisch anhand deines Planungstool-Kontos erkannt. Die erste Person einer Gemeinde wird Administrator.
        </p>
      </Card>
    </div>
  );
}

export function PendingPage({ me }: { me: Me }) {
  const logout = async () => {
    await api.post('/auth/logout');
    window.location.href = '/login';
  };
  return (
    <div className="login-page">
      <Card className="login-card">
        <img src="/favicon.svg" alt="" />
        <h1>Hallo {me.user.name.split(' ')[0]}!</h1>
        {me.user.status === 'disabled' ? (
          <p>Dein Zugang zu <b>{me.tenant.name}</b> wurde deaktiviert. Bitte wende dich an einen Administrator deiner Gemeinde.</p>
        ) : (
          <p>
            Deine Zugangsanfrage für <b>{me.tenant.name}</b> wurde gespeichert. Sobald ein Administrator dich freischaltet, kannst du kahal.tools nutzen.
          </p>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <Button onClick={() => window.location.reload()}>Erneut prüfen</Button>
          <Button variant="ghost" onClick={logout}>
            Abmelden
          </Button>
        </div>
      </Card>
    </div>
  );
}
