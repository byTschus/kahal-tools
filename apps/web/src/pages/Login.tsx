import { ArrowLeft, ArrowRight, Mic, Radio, Users } from 'lucide-react';
import { type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Alert, Avatar, Button, Spinner } from '../components/ui';
import { api, useApi } from '../lib/api';
import type { Me } from '../lib/types';

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
        <nav className="auth-legal" aria-label="Rechtliches">
          <a href="/datenschutz">Datenschutz</a>
          <a href="/impressum">Impressum</a>
        </nav>
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
            >
              Mit {tenant.provider.label} anmelden <ArrowRight size={16} />
            </a>
          ) : (
            <Alert kind="warning">
              Auf dem Server sind noch keine {tenant.provider.label}-Zugangsdaten hinterlegt. Bitte den Betreiber von kahal.tools kontaktieren.
            </Alert>
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
  const { data: providers, loading } = useApi<Provider[]>('/auth/providers');
  const available = providers?.filter((p) => p.globalApp) ?? [];

  return (
    <AuthShell>
      <h1>Anmelden</h1>
      <p className="lead">Melde dich mit deinem Planning-Center-Konto an. Deine Gemeinde wird dabei automatisch erkannt.</p>
      <Alert>{params.get('error')}</Alert>
      {loading ? (
        <Spinner />
      ) : available.length ? (
        <div className="stack">
          {available.map((p, i) => (
            <a key={p.key} className={`btn large block ${i === 0 ? 'primary' : ''}`} href={`/auth/${p.key}/login`}>
              Mit {p.label} anmelden <ArrowRight size={16} />
            </a>
          ))}
          <small>
            Ist deine Gemeinde noch nicht bei kahal.tools, wird sie bei der ersten Anmeldung eingerichtet und du wirst Administrator. Weitere Personen lädt ein
            Administrator ein oder schaltet sie nach der Anmeldung frei.
          </small>
        </div>
      ) : (
        <Alert kind="warning">Auf dem Server sind noch keine Planning-Center-Zugangsdaten hinterlegt. Bitte den Betreiber von kahal.tools kontaktieren.</Alert>
      )}
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
