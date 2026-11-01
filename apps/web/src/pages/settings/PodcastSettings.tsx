import { useEffect, useState } from 'react';
import { SamplePlanSelect, TemplateField, useSamplePlan } from '../../components/TemplateField';
import { Alert, Button, Card, Checkbox, ConfirmButton, Field, Spinner , Saved } from '../../components/ui';
import { api, useAction, useApi } from '../../lib/api';
import type { HostField, Integrations } from '../../lib/types';
import { useSettings } from './useSettings';
import { WorkerServerCard } from './WorkerServerCard';

interface PodcastSettingsData {
  titleTemplate: string;
  speakerTemplate: string;
  descriptionTemplate: string;
  imageTemplate: string;
  scriptureTemplate: string;
  bitrate: '64k' | '96k' | '128k' | '192k';
  mono: boolean;
  normalize: boolean;
  feed: {
    title: string;
    description: string;
    author: string;
    email: string;
    language: string;
    category: string;
    imageUrl: string;
    websiteUrl: string;
    explicit: boolean;
  };
  uploadFeed: boolean;
}

export function PodcastSettings() {
  const s = useSettings<PodcastSettingsData>('podcast');
  const sample = useSamplePlan();
  const setFeed = (key: keyof PodcastSettingsData['feed'], value: string | boolean) => s.form && s.set('feed', { ...s.form.feed, [key]: value });

  return (
    <>
      <HostCard />
      <WorkerServerCard />
      {!s.form ? (
        <Spinner />
      ) : (
        <>
          <Card title="Vorlagen für neue Podcasts">
            <div className="stack">
              <p className="muted">
                Zusätzlich zu den Plan-Variablen stehen <code>video.title</code>, <code>video.description</code> und <code>video.date</code> des YouTube-Videos zur
                Verfügung.
              </p>
              {sample.events.length > 0 && <SamplePlanSelect sample={sample} />}
              <TemplateField label="Titel" value={s.form.titleTemplate} onChange={(v) => s.set('titleTemplate', v)} sample={sample} />
              <TemplateField label="Sprecher" value={s.form.speakerTemplate} onChange={(v) => s.set('speakerTemplate', v)} sample={sample} />
              <TemplateField label="Beschreibung" multiline value={s.form.descriptionTemplate} onChange={(v) => s.set('descriptionTemplate', v)} sample={sample} />
              <TemplateField
                label="Podcast-Bild (URL)"
                value={s.form.imageTemplate}
                onChange={(v) => s.set('imageTemplate', v)}
                sample={sample}
                hint="z.B. {{series.artwork}} für das Serienbild aus Planning Center. Leer = Feed-Bild."
              />
              <TemplateField
                label="Bibelstelle"
                value={s.form.scriptureTemplate}
                onChange={(v) => s.set('scriptureTemplate', v)}
                sample={sample}
                hint="Optional, wird im eingebetteten Player angezeigt. Die MP3-Datei heisst immer nach dem Erstellungszeitpunkt (Sekunden seit 1970, z.B. 1787908529.mp3)."
              />
            </div>
          </Card>
          <Card title="Audio">
            <div className="grid grid-3">
              <Field label="Bitrate" hint="Für Sprache genügen 64–96 kbit/s (kleine Dateien, schneller Upload)">
                <select value={s.form.bitrate} onChange={(e) => s.set('bitrate', e.target.value as PodcastSettingsData['bitrate'])}>
                  <option value="64k">64 kbit/s</option>
                  <option value="96k">96 kbit/s</option>
                  <option value="128k">128 kbit/s</option>
                  <option value="192k">192 kbit/s</option>
                </select>
              </Field>
              <div className="stack" style={{ justifyContent: 'center' }}>
                <Checkbox checked={s.form.mono} onChange={(v) => s.set('mono', v)} label="Mono (empfohlen für Predigten)" />
                <Checkbox checked={s.form.normalize} onChange={(v) => s.set('normalize', v)} label="Lautstärke normalisieren (-16 LUFS)" />
              </div>
            </div>
          </Card>
          <Card title="Podcast-Feed">
            <div className="grid grid-2">
              <Field label="Titel des Podcasts">
                <input type="text" value={s.form.feed.title} onChange={(e) => setFeed('title', e.target.value)} />
              </Field>
              <Field label="Autor / Herausgeber">
                <input type="text" value={s.form.feed.author} onChange={(e) => setFeed('author', e.target.value)} />
              </Field>
              <Field label="Kontakt-E-Mail" hint="Wird von Apple Podcasts zur Verifizierung verwendet">
                <input type="email" value={s.form.feed.email} onChange={(e) => setFeed('email', e.target.value)} />
              </Field>
              <Field label="Webseite">
                <input type="text" value={s.form.feed.websiteUrl} onChange={(e) => setFeed('websiteUrl', e.target.value)} />
              </Field>
              <Field label="Cover-Bild (URL)" hint="Quadratisch, 1400–3000 px">
                <input type="text" value={s.form.feed.imageUrl} onChange={(e) => setFeed('imageUrl', e.target.value)} />
              </Field>
              <Field label="Kategorie">
                <input type="text" value={s.form.feed.category} onChange={(e) => setFeed('category', e.target.value)} />
              </Field>
              <Field label="Sprache">
                <input type="text" value={s.form.feed.language} onChange={(e) => setFeed('language', e.target.value)} />
              </Field>
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              <Field label="Beschreibung">
                <textarea className="prose" rows={3} value={s.form.feed.description} onChange={(e) => setFeed('description', e.target.value)} />
              </Field>
              <Checkbox checked={s.form.uploadFeed} onChange={(v) => s.set('uploadFeed', v)} label="Feed zusätzlich als feed.xml auf den FTP-Server hochladen" />
            </div>
          </Card>
          <Card>
            <Alert>{s.error}</Alert>
            <div className="row">
              <Button variant="primary" busy={s.busy} onClick={s.save}>
                Speichern
              </Button>
              <Saved show={s.saved} />
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function HostCard() {
  const { data: integrations, reload } = useApi<Integrations>('/api/integrations');
  const [provider, setProvider] = useState('ftp');
  const [values, setValues] = useState<Record<string, any>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const save = useAction();
  const test = useAction();

  const hostDef = integrations?.available.podcastHost.find((h) => h.key === provider);

  useEffect(() => {
    if (!integrations) return;
    const current = integrations.podcastHost;
    if (current) setProvider(current.provider);
    const def = integrations.available.podcastHost.find((h) => h.key === (current?.provider ?? provider));
    const init: Record<string, any> = {};
    for (const f of def?.fields ?? []) init[f.key] = f.secret ? '' : (current?.config?.[f.key] ?? f.default ?? '');
    setValues(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrations]);

  if (!integrations) return <Spinner />;
  const secretsSet = integrations.podcastHost?.secretsSet ?? {};

  const input = (f: HostField) => {
    const v = values[f.key];
    const onChange = (val: any) => setValues({ ...values, [f.key]: val });
    if (f.type === 'checkbox') return <Checkbox checked={Boolean(v)} onChange={onChange} label={f.label} />;
    if (f.type === 'select')
      return (
        <select value={v ?? ''} onChange={(e) => onChange(e.target.value)}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    return (
      <input
        type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
        value={v ?? ''}
        placeholder={f.secret && secretsSet[f.key] ? '•••••••• (unverändert)' : f.placeholder}
        autoComplete={f.secret ? 'new-password' : 'off'}
        onChange={(e) => onChange(f.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    );
  };

  return (
    <Card
      title="Podcast-Hosting"
      actions={
        integrations.podcastHost && (
          <ConfirmButton
            question="Podcast-Hosting entfernen? Bereits veröffentlichte Dateien bleiben auf dem Server."
            onConfirm={async () => {
              await api.del('/api/integrations/podcastHost');
              void reload();
            }}
          >
            Entfernen
          </ConfirmButton>
        )
      }
    >
      <p className="muted">Hierhin werden die fertigen MP3-Dateien hochgeladen. Die Dateien müssen über die angegebene URL öffentlich erreichbar sein.</p>
      {integrations.available.podcastHost.length > 1 && (
        <Field label="Anbieter">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {integrations.available.podcastHost.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-2" style={{ marginTop: 8 }}>
        {hostDef?.fields.map((f) =>
          f.type === 'checkbox' ? (
            <div key={f.key} className="field" style={{ justifyContent: 'center' }}>
              {input(f)}
            </div>
          ) : (
            <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.help}>
              {input(f)}
            </Field>
          ),
        )}
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        <Alert>{save.error ?? test.error}</Alert>
        {result && <Alert kind={result.ok ? 'success' : 'error'}>{result.message}</Alert>}
        <div className="row">
          <Button
            variant="primary"
            busy={save.busy}
            onClick={async () => {
              setResult(null);
              const ok = await save.run(() => api.put('/api/integrations/podcastHost', { provider, config: values }));
              if (ok) {
                setResult({ ok: true, message: 'Gespeichert.' });
                void reload();
              }
            }}
          >
            Speichern
          </Button>
          <Button
            busy={test.busy}
            onClick={async () => {
              setResult(null);
              const res = await test.run(() => api.post<{ ok: boolean; message: string }>('/api/integrations/podcastHost/test', { provider, config: values }));
              if (res) setResult(res);
            }}
          >
            Verbindung testen
          </Button>
        </div>
      </div>
    </Card>
  );
}
