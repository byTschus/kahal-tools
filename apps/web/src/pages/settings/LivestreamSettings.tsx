import { useSearchParams } from 'react-router-dom';
import { SamplePlanSelect, TemplateField, useSamplePlan } from '../../components/TemplateField';
import { Alert, Avatar, Button, Card, Checkbox, ConfirmButton, Field, Spinner , Saved } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { useCan } from '../../lib/auth';
import type { Integrations } from '../../lib/types';
import { LivestreamPlanMatchCard } from './ImportCards';
import { useSettings } from './useSettings';

interface LivestreamSettingsData {
  titleTemplate: string;
  descriptionTemplate: string;
  startItemTitle: string;
  startOffsetMinutes: number;
  privacy: 'public' | 'unlisted' | 'private';
  streamKeyId: string;
  playlistId: string;
  thumbnailTemplate: string;
  autoStart: boolean;
  autoStop: boolean;
}

export function LivestreamSettings() {
  const [params] = useSearchParams();
  const { data: integrations, reload } = useApi<Integrations>('/api/integrations');
  const connected = integrations?.streaming;
  const can = useCan();
  const { data: options } = useApi<{ streamKeys: { id: string; name: string }[]; playlists: { id: string; name: string }[] }>(
    connected ? '/api/integrations/streaming/options' : null,
  );
  const s = useSettings<LivestreamSettingsData>('livestream');
  const sample = useSamplePlan();

  return (
    <>
      <Card title="Streaming-Plattform">
        {params.get('connected') && <Alert kind="success">YouTube wurde erfolgreich verbunden.</Alert>}
        <Alert>{params.get('error')}</Alert>
        {!integrations ? (
          <Spinner />
        ) : connected ? (
          <div className="row between">
            <div className="row">
              <Avatar name={connected.config.accountName ?? 'YouTube'} url={connected.config.avatarUrl} />
              <div>
                <b>{connected.config.accountName}</b>
                <div>
                  <small>YouTube-Kanal verbunden</small>
                </div>
              </div>
            </div>
            <div className="row">
              <a className="btn small" href="/api/integrations/streaming/youtube/connect">
                Neu verbinden
              </a>
              <ConfirmButton
                question="YouTube-Verbindung trennen?"
                onConfirm={async () => {
                  await api.del('/api/integrations/streaming');
                  void reload();
                }}
              >
                Trennen
              </ConfirmButton>
            </div>
          </div>
        ) : (
          <div className="stack">
            <p className="muted">Verbinde den YouTube-Kanal der Gemeinde. Du wirst zu Google weitergeleitet und musst den Zugriff erlauben.</p>
            {integrations.available.streaming.map((p) =>
              p.globalApp ? (
                <a key={p.key} className="btn primary" href={`/api/integrations/streaming/${p.key}/connect`} style={{ alignSelf: 'flex-start' }}>
                  Mit {p.label} verbinden
                </a>
              ) : (
                <Alert key={p.key} kind="warning">
                  Für {p.label} sind auf dem Server noch keine API-Zugangsdaten hinterlegt (<code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code> in der
                  .env). Bitte den Betreiber von kahal.tools kontaktieren.
                </Alert>
              ),
            )}
          </div>
        )}
      </Card>

      {s.form && (
        <Card title="Vorlagen für neue Livestreams">
          <div className="stack">
            <Alert>{s.error}</Alert>
            {sample.events.length > 0 && <SamplePlanSelect sample={sample} />}
            <TemplateField label="Titel" value={s.form.titleTemplate} onChange={(v) => s.set('titleTemplate', v)} sample={sample} hint="Max. 100 Zeichen bei YouTube" />
            <TemplateField label="Beschreibung" multiline value={s.form.descriptionTemplate} onChange={(v) => s.set('descriptionTemplate', v)} sample={sample} />
            <TemplateField
              label="Thumbnail-Vorschlag (Bild-URL)"
              value={s.form.thumbnailTemplate}
              onChange={(v) => s.set('thumbnailTemplate', v)}
              sample={sample}
              hint="z.B. {{series.artwork}} für das Serienbild aus Planning Center. Beim Erstellen kann auch ein eigenes Bild hochgeladen werden."
            />
            <div className="grid grid-2">
              <Field
                label="Startzeit aus Plan-Item"
                hint="Titel (oder Teil davon) des Items im Plan, bei dem der Stream starten soll. Leer = Beginn des Gottesdienstes."
              >
                <input type="text" value={s.form.startItemTitle} onChange={(e) => s.set('startItemTitle', e.target.value)} list="plan-items" />
                <datalist id="plan-items">
                  {sample.vars?.items.map((i) => <option key={i.title} value={i.title} />)}
                </datalist>
              </Field>
              <Field label="Verschiebung (Minuten)" hint="z.B. -5 = 5 Minuten früher starten">
                <input type="number" value={s.form.startOffsetMinutes} onChange={(e) => s.set('startOffsetMinutes', Number(e.target.value))} />
              </Field>
              <Field label="Standard-Sichtbarkeit">
                <select value={s.form.privacy} onChange={(e) => s.set('privacy', e.target.value as LivestreamSettingsData['privacy'])}>
                  <option value="public">Öffentlich</option>
                  <option value="unlisted">Nicht gelistet</option>
                  <option value="private">Privat</option>
                </select>
              </Field>
              <Field label="Streamschlüssel" hint="Wird automatisch mit neuen Livestreams verknüpft (OBS/Encoder muss nicht umgestellt werden)">
                <select value={s.form.streamKeyId} onChange={(e) => s.set('streamKeyId', e.target.value)} disabled={!options}>
                  <option value="">– keiner (manuell in YouTube Studio) –</option>
                  {options?.streamKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Playlist (Vorauswahl)" hint="Wird beim Erstellen vorgeschlagen und kann pro Livestream geändert werden">
                <select value={s.form.playlistId} onChange={(e) => s.set('playlistId', e.target.value)} disabled={!options}>
                  <option value="">– keine –</option>
                  {options?.playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="stack" style={{ justifyContent: 'center' }}>
                <Checkbox checked={s.form.autoStart} onChange={(v) => s.set('autoStart', v)} label="Automatisch starten, sobald der Encoder sendet" />
                <Checkbox checked={s.form.autoStop} onChange={(v) => s.set('autoStop', v)} label="Automatisch beenden, wenn der Encoder stoppt" />
              </div>
            </div>
            <div className="row">
              <Button variant="primary" busy={s.busy} onClick={s.save}>
                Speichern
              </Button>
              <Saved show={s.saved} />
            </div>
          </div>
        </Card>
      )}
      {connected && can('livestream', 'edit') && <LivestreamPlanMatchCard />}
    </>
  );
}
