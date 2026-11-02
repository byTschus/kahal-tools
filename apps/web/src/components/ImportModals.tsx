import { FileUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, useAction } from '../lib/api';
import { fmtDate, fmtDuration, fmtNumber } from '../lib/format';
import { MATCH_LABEL, MatchingInfo, PlanMatchBadge, type MatchedPlan, type MatchingSummary } from './PlanMatch';
import { Alert, Badge, Button, Checkbox, Modal, Spinner } from './ui';

/** Import bestehender Daten (in den Einstellungen der Tools) */

interface ImportPreview {
  columns: { header: string; kind: 'date' | 'time' | 'title' | 'livestream' | 'notes' | 'total' | 'location' | 'newLocation' | 'ignored' }[];
  total: number;
  duplicates: number;
  errors: { line: number; message: string }[];
  sample: { line: number; date: string; title: string; values: Record<string, number>; livestream: number | null; duplicate: boolean }[];
  matching?: MatchingSummary & { rows: { line: number; date: string; title: string; plan: MatchedPlan | null; ambiguous: boolean }[] };
}

const KIND_LABEL: Record<ImportPreview['columns'][number]['kind'], string> = {
  date: 'Datum',
  time: 'Uhrzeit',
  title: 'Titel',
  livestream: 'Livestream',
  notes: 'Bemerkung',
  total: 'Total (wird berechnet)',
  location: 'Ort',
  newLocation: 'Neuer Ort',
  ignored: 'Wird ignoriert',
};

export function VisitorImportModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [createLocations, setCreateLocations] = useState(true);
  const [matchPlans, setMatchPlans] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const load = useAction();
  const run = useAction();
  const url = (commit: boolean) =>
    `/api/visitors/import?fileName=${encodeURIComponent(file?.name ?? '')}&createLocations=${createLocations}&matchPlans=${matchPlans}${commit ? '&commit=true' : ''}`;

  useEffect(() => {
    if (!file) return;
    setPreview(null);
    void load.run(() => api.upload<ImportPreview>(url(false), file)).then((res) => res && setPreview(res));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, createLocations, matchPlans]);

  const commit = async () => {
    if (!file) return;
    const res = await run.run(() => api.upload<{ imported: number; skipped: number; linked: number; matchError?: string }>(url(true), file));
    if (res)
      onDone(
        `${res.imported} Erfassungen importiert${res.linked ? `, ${res.linked} davon einem Plan zugeordnet` : ''}${res.skipped ? `, ${res.skipped} bereits vorhanden und übersprungen` : ''}.${res.matchError ? ` ${res.matchError}` : ''}`,
      );
  };

  const importable = preview ? preview.total - preview.duplicates : 0;

  return (
    <Modal
      title="Besucherzahlen importieren"
      wide
      onClose={onClose}
      footer={
        preview ? (
          <Button variant="primary" busy={run.busy} disabled={!importable} onClick={commit}>
            {importable} Erfassungen importieren
          </Button>
        ) : null
      }
    >
      <p className="muted">
        CSV- oder Excel-Datei (.xlsx) mit einer Zeile pro Gottesdienst. Erste Zeile = Überschriften: <b>Datum</b> (Pflicht), optional <b>Uhrzeit</b>, <b>Titel</b>,{' '}
        <b>Livestream</b> und <b>Bemerkung</b>. Alle weiteren Spalten sind Orte, z.B. „Saal EG“. Ohne Uhrzeit wird 10:00 angenommen. Neue Einträge können automatisch
        dem Plan vom selben Tag zugeordnet werden; fehlen Uhrzeit oder Titel in der Datei, werden sie aus dem Plan übernommen.
      </p>
      <code style={{ display: 'block', fontSize: '0.8rem', padding: 10, background: 'var(--surface-2)', borderRadius: 8, whiteSpace: 'pre', overflowX: 'auto' }}>
        {'Datum;Titel;Saal EG;Kinderprogramm;Livestream\n05.01.2025;Gottesdienst;142;31;58'}
      </code>
      <div className="row">
        <label className="btn" style={{ cursor: 'pointer' }}>
          <FileUp size={16} /> {file ? 'Andere Datei' : 'Datei wählen'}
          <input type="file" accept=".csv,.txt,.xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {file && <small>{file.name}</small>}
      </div>
      <Checkbox checked={createLocations} onChange={setCreateLocations} label="Unbekannte Spalten als neue Orte anlegen" />
      <Checkbox checked={matchPlans} onChange={setMatchPlans} label={MATCH_LABEL} />
      <Alert>{load.error ?? run.error}</Alert>
      {load.busy && <Spinner label="Datei wird geprüft …" />}
      {preview && (
        <div className="stack">
          <div className="row" style={{ gap: 6 }}>
            {preview.columns
              .filter((c) => c.header)
              .map((c) => (
                <Badge key={c.header} color={c.kind === 'ignored' ? undefined : c.kind === 'newLocation' ? 'blue' : 'green'} plain>
                  {c.header}: {KIND_LABEL[c.kind]}
                </Badge>
              ))}
          </div>
          <div>
            {preview.total} Zeilen erkannt{preview.duplicates ? `, davon ${preview.duplicates} bereits vorhanden` : ''}.
          </div>
          {preview.errors.length > 0 && (
            <Alert kind="warning">
              {preview.errors.slice(0, 5).map((e) => (
                <div key={e.line}>
                  Zeile {e.line}: {e.message}
                </div>
              ))}
              {preview.errors.length > 5 && <div>… und {preview.errors.length - 5} weitere</div>}
            </Alert>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Titel</th>
                  <th>Werte</th>
                  <th className="num">Livestream</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r) => (
                  <tr key={r.line} style={r.duplicate ? { opacity: 0.5 } : undefined}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.title}</td>
                    <td>
                      <small>
                        {Object.entries(r.values)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(', ')}
                      </small>
                    </td>
                    <td className="num">{fmtNumber(r.livestream)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.matching && importable > 0 && (
            <>
              <MatchingInfo matching={preview.matching} total={importable} />
              {!preview.matching.error && (
                <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th>Titel</th>
                        <th>Plan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.matching.rows.map((r) => (
                        <tr key={r.line}>
                          <td>{fmtDate(r.date)}</td>
                          <td>{r.title}</td>
                          <td style={{ maxWidth: 280 }}>
                            <PlanMatchBadge plan={r.plan} ambiguous={r.ambiguous} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

interface FeedPreview {
  channel: { title: string; description: string; author: string; imageUrl: string };
  total: number;
  new: number;
  matching?: MatchingSummary;
  episodes: { title: string; publishedAt: string | null; durationSec: number | null; isNew: boolean; plan: MatchedPlan | null; ambiguous: boolean }[];
}

export function FeedImportModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [url, setUrl] = useState('');
  const [adoptChannel, setAdoptChannel] = useState(true);
  const [matchPlans, setMatchPlans] = useState(true);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const load = useAction();
  const run = useAction();

  const loadPreview = async (match = matchPlans) => {
    setPreview(null);
    const res = await load.run(() => api.post<FeedPreview>('/api/podcasts/import-feed', { url, matchPlans: match }));
    if (res) setPreview(res);
  };

  const commit = async () => {
    const res = await run.run(() =>
      api.post<{ imported: number; skipped: number; linked: number; matchError?: string }>('/api/podcasts/import-feed', { url, commit: true, adoptChannel, matchPlans }),
    );
    if (res)
      onDone(
        `${res.imported} Episoden importiert${res.linked ? `, ${res.linked} davon einem Plan zugeordnet` : ''}${res.skipped ? `, ${res.skipped} bereits vorhanden` : ''}.${res.matchError ? ` ${res.matchError}` : ''}`,
      );
  };

  return (
    <Modal
      title="Bestehenden Podcast-Feed importieren"
      wide
      onClose={onClose}
      footer={
        preview ? (
          <Button variant="primary" busy={run.busy} disabled={!preview.new} onClick={commit}>
            {preview.new} Episoden importieren
          </Button>
        ) : null
      }
    >
      <p className="muted">
        Übernimmt die Episoden eines bestehenden RSS-Feeds. Die Audiodateien bleiben beim bisherigen Anbieter und werden verlinkt. Die Episoden können anhand des
        Veröffentlichungsdatums automatisch einem Plan zugeordnet werden, sonst verknüpfst du den Plan später beim Bearbeiten.
      </p>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="url" placeholder="https://… /feed.xml" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && loadPreview()} />
        <Button busy={load.busy} disabled={!url.trim()} onClick={() => loadPreview()}>
          Feed laden
        </Button>
      </div>
      <Checkbox
        checked={matchPlans}
        onChange={(v) => {
          setMatchPlans(v);
          if (preview) void loadPreview(v);
        }}
        label={MATCH_LABEL}
      />
      <Alert>{load.error ?? run.error}</Alert>
      {load.busy && matchPlans && <Spinner label="Feed und Pläne werden geladen …" />}
      {preview && (
        <div className="stack">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {preview.channel.imageUrl && <img src={preview.channel.imageUrl} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6 }} />}
            <div>
              <div className="cell-title">{preview.channel.title || 'Ohne Titel'}</div>
              <div className="cell-sub">
                {preview.total} Episoden, davon {preview.new} neu
              </div>
            </div>
          </div>
          {preview.matching && preview.new > 0 && <MatchingInfo matching={preview.matching} total={preview.new} />}
          <div className="scroll-list" style={{ maxHeight: 260 }}>
            {preview.episodes.map((e, i) => (
              <div key={i} className="list-item" style={{ cursor: 'default', opacity: e.isNew ? 1 : 0.55 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-title">{e.title}</div>
                  <div className="cell-sub">
                    {fmtDate(e.publishedAt, false)} {e.durationSec ? `· ${fmtDuration(e.durationSec)}` : ''}
                  </div>
                </div>
                {!e.isNew ? (
                  <Badge plain>bereits vorhanden</Badge>
                ) : (
                  preview.matching &&
                  !preview.matching.error && (
                    <div style={{ maxWidth: '45%' }}>
                      <PlanMatchBadge plan={e.plan} ambiguous={e.ambiguous} />
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
          <Checkbox checked={adoptChannel} onChange={setAdoptChannel} label="Leere Feed-Angaben (Titel, Beschreibung, Autor, Bild …) aus diesem Feed übernehmen" />
        </div>
      )}
    </Modal>
  );
}
