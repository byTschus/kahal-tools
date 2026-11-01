import { useEffect, useState, type ReactNode } from 'react';
import { api, useAction } from '../lib/api';
import { CopyField } from './CopyField';
import { Alert, Badge, Button, Card, ConfirmButton, Field } from './ui';

export interface OAuthAppStatus {
  clientId: string;
  secretSet: boolean;
  source: 'tenant' | 'global' | null;
  redirectUri: string;
}

/** Eigene OAuth-App-Zugangsdaten (Client ID / Secret) der Gemeinde für einen Anbieter */
export function OAuthAppCard({
  provider,
  title,
  status,
  onChanged,
  instructions,
  warning,
}: {
  provider: 'pco' | 'youtube';
  title: string;
  status: OAuthAppStatus;
  onChanged: () => void;
  instructions: ReactNode;
  warning?: string;
}) {
  const [clientId, setClientId] = useState(status.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [saved, setSaved] = useState(false);
  const save = useAction();
  useEffect(() => setClientId(status.clientId), [status.clientId]);

  return (
    <Card
      title={title}
      actions={
        status.source === 'tenant' ? (
          <Badge color="green">Eigene Zugangsdaten</Badge>
        ) : status.source === 'global' ? (
          <Badge color="blue">Zugangsdaten des Betreibers</Badge>
        ) : (
          <Badge color="yellow">Nicht eingerichtet</Badge>
        )
      }
    >
      <div className="stack">
        <details open={!status.source}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Anleitung</summary>
          <div style={{ marginTop: 8 }}>{instructions}</div>
        </details>
        <Field label="Redirect-/Callback-URL (in der App beim Anbieter eintragen)">
          <CopyField value={status.redirectUri} />
        </Field>
        <div className="grid grid-2">
          <Field label="Client ID">
            <input type="text" value={clientId} onChange={(e) => (setClientId(e.target.value), setSaved(false))} autoComplete="off" />
          </Field>
          <Field label="Client Secret" hint={status.secretSet ? 'Leer lassen, um das gespeicherte Secret zu behalten' : undefined}>
            <input
              type="password"
              value={clientSecret}
              placeholder={status.secretSet ? '•••••••• (gespeichert)' : ''}
              onChange={(e) => (setClientSecret(e.target.value), setSaved(false))}
              autoComplete="new-password"
            />
          </Field>
        </div>
        {warning && status.source === 'tenant' && <Alert kind="info">{warning}</Alert>}
        <Alert>{save.error}</Alert>
        <div className="row">
          <Button
            variant="primary"
            busy={save.busy}
            disabled={!clientId.trim() || (!status.secretSet && !clientSecret.trim())}
            onClick={async () => {
              const ok = await save.run(() => api.put(`/api/oauth-apps/${provider}`, { clientId, clientSecret: clientSecret || undefined }));
              if (ok) {
                setClientSecret('');
                setSaved(true);
                onChanged();
              }
            }}
          >
            Zugangsdaten speichern
          </Button>
          {status.source === 'tenant' && (
            <ConfirmButton
              question="Eigene Zugangsdaten entfernen?"
              onConfirm={async () => {
                const ok = await save.run(() => api.del(`/api/oauth-apps/${provider}`));
                if (ok) onChanged();
              }}
            >
              Entfernen
            </ConfirmButton>
          )}
          {saved && <span className="muted">✓ Gespeichert</span>}
        </div>
      </div>
    </Card>
  );
}
