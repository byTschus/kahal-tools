import { ArrowDown, ArrowUp, MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, ConfirmButton, Empty, Field, Spinner , Saved } from '../../components/ui';
import { api, useAction, useApi } from '../../lib/api';
import { useCan } from '../../lib/auth';
import type { Integrations, VisitorLocation } from '../../lib/types';
import { VisitorImportCard } from './ImportCards';
import { useSettings } from './useSettings';

export function VisitorSettings() {
  const { data: locations, loading, reload } = useApi<VisitorLocation[]>('/api/visitors/locations');
  const { data: integrations } = useApi<Integrations>('/api/integrations');
  const can = useCan();
  const s = useSettings<{ livestreamEnabled: boolean; livestreamMode: 'concurrent' | 'views' }>('visitors');
  const [name, setName] = useState('');
  const add = useAction();

  const addLocation = async () => {
    const ok = await add.run(() => api.post('/api/visitors/locations', { name }));
    if (ok) {
      setName('');
      void reload();
    }
  };

  const move = async (loc: VisitorLocation, dir: -1 | 1) => {
    if (!locations) return;
    const idx = locations.findIndex((l) => l.id === loc.id);
    const other = locations[idx + dir];
    if (!other) return;
    await Promise.all([
      api.patch(`/api/visitors/locations/${loc.id}`, { sortOrder: other.sortOrder }),
      api.patch(`/api/visitors/locations/${other.id}`, { sortOrder: loc.sortOrder }),
    ]);
    void reload();
  };

  return (
    <>
      <Card title="Orte">
        <p className="muted">Für jeden Ort (z.B. „Saal EG“, „Saal OG“, „Kinderprogramm“) wird bei der Erfassung eine eigene Zahl eingetragen.</p>
        <Alert>{add.error}</Alert>
        {loading && !locations ? (
          <Spinner />
        ) : !locations?.length ? (
          <Empty icon={MapPin} title="Noch keine Orte" />
        ) : (
          <table>
            <tbody>
              {locations.map((l, i) => (
                <tr key={l.id}>
                  <td>
                    <InlineName location={l} onSaved={reload} /> {!l.active && <Badge>inaktiv</Badge>}
                  </td>
                  <td>
                    <div className="actions">
                      <Button size="small" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(l, -1)} title="Nach oben" aria-label="Nach oben" />
                      <Button size="small" variant="ghost" icon={ArrowDown} disabled={i === locations.length - 1} onClick={() => move(l, 1)} title="Nach unten" aria-label="Nach unten" />
                      {l.active ? (
                        <ConfirmButton
                          question={`Ort „${l.name}“ entfernen? Bereits erfasste Zahlen bleiben in der Statistik erhalten.`}
                          onConfirm={async () => {
                            await api.del(`/api/visitors/locations/${l.id}`);
                            void reload();
                          }}
                        >
                          Entfernen
                        </ConfirmButton>
                      ) : (
                        <Button
                          size="small"
                          onClick={async () => {
                            await api.patch(`/api/visitors/locations/${l.id}`, { active: true });
                            void reload();
                          }}
                        >
                          Reaktivieren
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 12, flexWrap: 'nowrap' }}>
          <input type="text" placeholder="Neuer Ort, z.B. Saal EG" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && addLocation()} />
          <Button variant="primary" icon={Plus} busy={add.busy} disabled={!name.trim()} onClick={addLocation}>
            Hinzufügen
          </Button>
        </div>
      </Card>

      <Card title="Livestream-Zuschauer">
        {!integrations?.streaming && <Alert kind="info">Verbinde zuerst YouTube unter Einstellungen → Livestream, um Zuschauerzahlen automatisch zu übernehmen.</Alert>}
        {s.form && (
          <div className="stack">
            <Checkbox checked={s.form.livestreamEnabled} onChange={(v) => s.set('livestreamEnabled', v)} label="Livestream standardmässig mitzählen" />
            <Field
              label="Welcher Wert soll übernommen werden?"
              hint="Der Spitzenwert der gleichzeitigen Zuschauer wird von kahal.tools während des Streams aufgezeichnet (nur für Streams, die mit kahal.tools erstellt wurden). Aufrufe können auch später noch gelesen werden."
            >
              <select value={s.form.livestreamMode} onChange={(e) => s.set('livestreamMode', e.target.value as 'concurrent' | 'views')}>
                <option value="concurrent">Gleichzeitige Zuschauer (Spitzenwert)</option>
                <option value="views">Aufrufe</option>
              </select>
            </Field>
            <Alert>{s.error}</Alert>
            <div className="row">
              <Button variant="primary" busy={s.busy} onClick={s.save}>
                Speichern
              </Button>
              <Saved show={s.saved} />
            </div>
          </div>
        )}
      </Card>
      {can('visitors', 'create') && <VisitorImportCard />}
    </>
  );
}

function InlineName({ location, onSaved }: { location: VisitorLocation; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(location.name);
  if (!editing)
    return (
      <span onDoubleClick={() => setEditing(true)} title="Doppelklick zum Umbenennen" style={{ cursor: 'text' }}>
        {location.name}
      </span>
    );
  const commit = async () => {
    setEditing(false);
    if (name.trim() && name !== location.name) {
      await api.patch(`/api/visitors/locations/${location.id}`, { name: name.trim() });
      onSaved();
    }
  };
  return <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} style={{ maxWidth: 260 }} />;
}
