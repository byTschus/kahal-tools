import { ArrowLeft, ArrowRight, Mic, Plus, Radio, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { CopyField } from '../components/CopyField';
import { Alert, Avatar, Button, Field, Spinner } from '../components/ui';
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

function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Brand subtitle="für Gemeinden" />
        <div>
          <h2>Die Technik rund um den Gottesdienst – an einem Ort.</h2>
          <ul>
            <li>
              <Radio size={18} />
              <span>
                <b>Livestream</b>Streams direkt aus dem Plan anlegen, mit Titel, Beschreibung und Startzeit.
              </span>
            </li>
            <li>
              <Mic size={18} />
              <span>
                <b>Podcast</b>Die Predigt aus dem Stream schneiden und automatisch veröffentlichen.
              </span>
            </li>
            <li>
              <Users size={18} />
              <span>
                <b>Besucherzähler</b>Besucher vor Ort und online erfassen und auswerten.
              </span>
            </li>
          </ul>
        </div>
        <small style={{ color: 'rgba(232,239,233,0.5)' }}>Verbunden mit Planning Center</small>
        <svg className="lines" viewBox="0 0 200 200" fill="none" stroke="#8fd3bd" strokeWidth="1.2" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx="200" cy="200" r={30 + i * 20} />
          ))}
        </svg>
      </aside>
      <main className="auth-main">
        <div className={`auth-card ${wide ? 'wide' : ''}`}>
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          {children}
        </div>
      </main>
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
    <AuthShell>
      {loading ? (
        <Spinner />
      ) : error || !tenant ? (
        <>
          <h1>Gemeinde nicht gefunden</h1>
          <p className="lead">Zum Kürzel „{slug}“ gibt es keine Gemeinde.</p>
          <Link to="/login" className="btn block">
            <ArrowLeft size={16} /> Zur Anmeldung
          </Link>
        </>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Avatar name={tenant.name} url={tenant.avatarUrl} size={44} />
            <div>
              <h1>{tenant.name}</h1>
              <small>Anmeldung bei kahal.tools</small>
            </div>
          </div>
          <Alert>{params.get('error')}</Alert>
          {tenant.ready ? (
            <a
              className="btn primary large block"
              href={`/auth/${tenant.provider.key}/login?tenant=${encodeURIComponent(tenant.slug)}`}
              onClick={() => rememberTenant(tenant.slug)}
            >
              Mit {tenant.provider.label} anmelden <ArrowRight size={16} />
            </a>
          ) : (
            <Alert kind="warning">Für diese Gemeinde sind keine {tenant.provider.label}-Zugangsdaten hinterlegt. Bitte wende dich an einen Administrator.</Alert>
          )}
          <small>
            Nicht deine Gemeinde? <Link to="/login">Andere Gemeinde wählen</Link>
          </small>
        </>
      )}
    </AuthShell>
  );
}

function GenericLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: providers, loading } = useApi<Provider[]>('/auth/providers');
  const [slug, setSlug] = useState(lastTenant() ?? '');

  return (
    <AuthShell>
      <h1>Anmelden</h1>
      <p className="lead">Gib das Kürzel deiner Gemeinde ein. Du findest es im Login-Link, den du erhalten hast.</p>
      <Alert>{params.get('error')}</Alert>
      {loading ? (
        <Spinner />
      ) : (
        <>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (slug.trim()) navigate(`/login/${encodeURIComponent(slug.trim().toLowerCase())}`);
            }}
          >
            <Field label="Gemeinde-Kürzel">
              <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="meine-gemeinde" autoFocus />
            </Field>
            <Button variant="primary" size="large" className="block" disabled={!slug.trim()}>
              Weiter <ArrowRight size={16} />
            </Button>
          </form>
          {providers
            ?.filter((p) => p.globalApp)
            .map((p) => (
              <a key={p.key} className="btn large block" href={`/auth/${p.key}/login`}>
                Mit {p.label} anmelden
              </a>
            ))}
          <div className="divider">Neu hier?</div>
          <Link to="/setup" className="btn large block">
            <Plus size={16} /> Gemeinde einrichten
          </Link>
        </>
      )}
    </AuthShell>
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
    <AuthShell wide>
      <Link to="/login" className="meta">
        <ArrowLeft size={15} /> Zurück
      </Link>
      <h1>Gemeinde einrichten</h1>
      <p className="lead">Verbinde kahal.tools mit dem Planning Center deiner Gemeinde. Das dauert etwa fünf Minuten.</p>
      <Alert>{params.get('error') ?? action.error}</Alert>
      <ol className="steps">
        <li>
          In Planning Center anmelden und{' '}
          <a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noreferrer">
            OAuth Applications
          </a>{' '}
          öffnen.
        </li>
        <li>„New Application“ wählen, Name z.B. „kahal.tools“.</li>
        <li>Diese Adresse als Callback-URL eintragen:</li>
      </ol>
      <CopyField value={redirectUri} />
      <ol className="steps" start={4}>
        <li>Speichern und Client ID sowie Secret hier eintragen.</li>
      </ol>
      <Field label="Client ID">
        <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Secret">
        <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
      </Field>
      <Button variant="primary" size="large" busy={action.busy} disabled={!clientId || !clientSecret} onClick={submit}>
        Weiter zu Planning Center <ArrowRight size={16} />
      </Button>
      <small>
        Deine Gemeinde wird anhand deines Planning-Center-Kontos erkannt, und du wirst Administrator. Die Zugangsdaten werden verschlüsselt gespeichert.
      </small>
    </AuthShell>
  );
}

export function PendingPage({ me }: { me: Me }) {
  const logout = async () => {
    await api.post('/auth/logout');
    window.location.href = `/login/${me.tenant.slug}`;
  };
  return (
    <AuthShell>
      <h1>Hallo {me.user.name.split(' ')[0]}</h1>
      {me.user.status === 'disabled' ? (
        <p className="lead">Dein Zugang zu {me.tenant.name} ist deaktiviert. Bitte wende dich an einen Administrator.</p>
      ) : (
        <p className="lead">
          Deine Anfrage für <b>{me.tenant.name}</b> ist eingegangen. Sobald ein Administrator dich freischaltet, kannst du loslegen.
        </p>
      )}
      <div className="row">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Erneut prüfen
        </Button>
        <Button variant="ghost" onClick={logout}>
          Abmelden
        </Button>
      </div>
    </AuthShell>
  );
}
