import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CopyField } from '../components/CopyField';
import { Alert, Avatar, Button, Card, Field, Spinner } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import type { Me } from '../lib/types';

const LAST_TENANT_KEY = 'kahal.lastTenant';

export function rememberTenant(slug: string) {
  try {
    localStorage.setItem(LAST_TENANT_KEY, slug);
  } catch {
    /* ignorieren */
  }
}

function lastTenant() {
  try {
    return localStorage.getItem(LAST_TENANT_KEY);
  } catch {
    return null;
  }
}

interface Provider {
  key: string;
  label: string;
  requiresApp: boolean;
  globalApp: boolean;
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-page">
      <Card className="login-card">
        <img src="/favicon.svg" alt="" />
        {children}
      </Card>
    </div>
  );
}

/** /login und /login/:slug */
export function LoginPage() {
  const { slug } = useParams();
  return slug ? <TenantLogin slug={slug} /> : <GenericLogin />;
}

function TenantLogin({ slug }: { slug: string }) {
  const [params] = useSearchParams();
  const { data: tenant, loading, error } = useApi<{ name: string; slug: string; avatarUrl: string | null; provider: { key: string; label: string }; ready: boolean }>(
    `/auth/tenant/${encodeURIComponent(slug)}`,
  );
  return (
    <LoginShell>
      {loading ? (
        <Spinner />
      ) : error || !tenant ? (
        <>
          <h1>kahal.tools</h1>
          <Alert>Gemeinde „{slug}“ wurde nicht gefunden.</Alert>
          <Link to="/login">Zur allgemeinen Anmeldung</Link>
        </>
      ) : (
        <>
          <h1>{tenant.name}</h1>
          <p className="muted">Anmeldung bei kahal.tools</p>
          <Alert>{params.get('error')}</Alert>
          {tenant.ready ? (
            <a className="btn primary large block" href={`/auth/${tenant.provider.key}/login?tenant=${encodeURIComponent(tenant.slug)}`} onClick={() => rememberTenant(tenant.slug)}>
              Mit {tenant.provider.label} anmelden
            </a>
          ) : (
            <Alert kind="warning">Für diese Gemeinde sind keine {tenant.provider.label}-Zugangsdaten hinterlegt. Bitte einen Administrator kontaktieren.</Alert>
          )}
          <p className="muted" style={{ marginTop: 24, fontSize: '0.85rem' }}>
            <Link to="/login">Andere Gemeinde?</Link>
          </p>
        </>
      )}
    </LoginShell>
  );
}

function GenericLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: providers, loading } = useApi<Provider[]>('/auth/providers');
  const [slug, setSlug] = useState(lastTenant() ?? '');

  return (
    <LoginShell>
      <h1>kahal.tools</h1>
      <p className="muted">Technik-Tools für deine Gemeinde: Livestream, Podcast, Besucherzähler.</p>
      <Alert>{params.get('error')}</Alert>
      {loading ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ marginTop: 16, textAlign: 'left' }}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (slug.trim()) navigate(`/login/${encodeURIComponent(slug.trim().toLowerCase())}`);
            }}
          >
            <Field label="Gemeinde-Kürzel" hint="Steht im Login-Link deiner Gemeinde: …/login/kürzel">
              <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="z.B. meine-gemeinde" />
            </Field>
            <Button variant="primary" className="block" disabled={!slug.trim()}>
              Weiter
            </Button>
          </form>
          {providers
            ?.filter((p) => p.globalApp)
            .map((p) => (
              <a key={p.key} className="btn block" href={`/auth/${p.key}/login`}>
                {p.key === 'mock' ? `Mit ${p.label} anmelden` : `Mit ${p.label} anmelden (ohne Kürzel)`}
              </a>
            ))}
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', width: '100%' }} />
          <Link to="/setup" className="btn block">
            ✨ Neue Gemeinde einrichten
          </Link>
        </div>
      )}
    </LoginShell>
  );
}

/** Erste Einrichtung einer Gemeinde: eigene Planning-Center-App-Zugangsdaten eingeben, danach anmelden */
export function SetupPage() {
  const [params] = useSearchParams();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const action = useAction();
  const redirectUri = `${window.location.origin}/auth/pco/callback`;

  const submit = async () => {
    const res = await action.run(() => api.post<{ url: string }>('/auth/pco/setup', { clientId, clientSecret }));
    if (res) window.location.href = res.url;
  };

  return (
    <div className="login-page">
      <Card className="login-card" >
        <div style={{ textAlign: 'left' }} className="stack">
          <h1 style={{ textAlign: 'center' }}>Neue Gemeinde einrichten</h1>
          <Alert>{params.get('error') ?? action.error}</Alert>
          <p>Damit kahal.tools auf Planning Center zugreifen darf, braucht deine Gemeinde eine eigene, kostenlose OAuth-App:</p>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            <li>
              In Planning Center anmelden und{' '}
              <a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noreferrer">
                api.planningcenteronline.com/oauth/applications
              </a>{' '}
              öffnen.
            </li>
            <li>„New Application“ → Name z.B. „kahal.tools“.</li>
            <li>Als Callback-/Redirect-URL eintragen:</li>
          </ol>
          <CopyField value={redirectUri} />
          <ol start={4} style={{ paddingLeft: 20, margin: 0 }}>
            <li>Speichern und Client ID + Secret hier eintragen:</li>
          </ol>
          <Field label="Client ID">
            <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Secret">
            <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button variant="primary" size="large" busy={action.busy} disabled={!clientId || !clientSecret} onClick={submit}>
            Weiter zur Anmeldung bei Planning Center
          </Button>
          <small className="muted">
            Die Gemeinde wird anhand deines Planning-Center-Kontos erkannt; du wirst Administrator. Die Zugangsdaten werden verschlüsselt gespeichert und können später
            unter Einstellungen → Planungstool geändert werden.
          </small>
          <Link to="/login" style={{ textAlign: 'center' }}>
            ← Zurück zur Anmeldung
          </Link>
        </div>
      </Card>
    </div>
  );
}

export function PendingPage({ me }: { me: Me }) {
  const logout = async () => {
    await api.post('/auth/logout');
    window.location.href = `/login/${me.tenant.slug}`;
  };
  return (
    <LoginShell>
      <h1>Hallo {me.user.name.split(' ')[0]}!</h1>
      <div className="row" style={{ justifyContent: 'center', marginBottom: 12 }}>
        <Avatar name={me.tenant.name} />
        <b>{me.tenant.name}</b>
      </div>
      {me.user.status === 'disabled' ? (
        <p>Dein Zugang wurde deaktiviert. Bitte wende dich an einen Administrator deiner Gemeinde.</p>
      ) : (
        <p>Deine Zugangsanfrage wurde gespeichert. Sobald ein Administrator dich freischaltet, kannst du kahal.tools nutzen.</p>
      )}
      <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
        <Button onClick={() => window.location.reload()}>Erneut prüfen</Button>
        <Button variant="ghost" onClick={logout}>
          Abmelden
        </Button>
      </div>
    </LoginShell>
  );
}
