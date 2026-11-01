import { Braces, Eye } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import type { PlanningEvent } from '../lib/types';
import { Button, Field } from './ui';

export interface VariableInfo {
  path: string;
  sample: string;
}

/**
 * Lädt Variablen eines Beispiel-Plans (für Vorschau und Variablen-Hilfe in den Einstellungen).
 */
export function useSamplePlan() {
  const { data: events } = useApi<PlanningEvent[]>('/api/planning/events?range=past');
  const [eventId, setEventId] = useState<string | null>(null);
  const selected = eventId ?? events?.[0]?.id ?? null;
  const { data: vars, loading, error } = useApi<{ variables: VariableInfo[]; filters: string[]; items: { title: string; startsAt: string | null }[] }>(
    selected ? `/api/planning/events/${encodeURIComponent(selected)}/variables` : null,
  );
  return { events: events ?? [], eventId: selected, setEventId, vars, loading, error };
}

export function SamplePlanSelect({ sample }: { sample: ReturnType<typeof useSamplePlan> }) {
  return (
    <Field label="Beispiel-Plan für die Vorschau" hint="Die Variablen und die Vorschau werden mit diesem Plan berechnet.">
      <select value={sample.eventId ?? ''} onChange={(e) => sample.setEventId(e.target.value)}>
        {sample.events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title} – {e.startsAt ? new Date(e.startsAt).toLocaleDateString('de-CH') : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Eingabefeld für ein Template mit klickbaren Variablen und Live-Vorschau */
export function TemplateField({
  label,
  value,
  onChange,
  multiline,
  hint,
  sample,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
  sample: ReturnType<typeof useSamplePlan>;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [showVars, setShowVars] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const insert = (path: string) => {
    const el = ref.current;
    const token = `{{${path}}}`;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const doPreview = async () => {
    if (!sample.eventId) return;
    const res = await api.post<Record<string, string>>('/api/planning/preview', { eventId: sample.eventId, templates: { v: value }, freitext: '(Freitext)' });
    setPreview(res.v);
  };

  const vars = (sample.vars?.variables ?? []).filter((v) => !filter || v.path.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <textarea ref={ref} rows={5} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input ref={ref} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      <div className="row">
        <Button type="button" size="small" variant="ghost" icon={Braces} onClick={() => setShowVars((s) => !s)}>
          {showVars ? 'Variablen ausblenden' : 'Variable einfügen'}
        </Button>
        <Button type="button" size="small" variant="ghost" icon={Eye} onClick={doPreview} disabled={!sample.eventId}>
          Vorschau
        </Button>
      </div>
      {showVars && (
        <div className="stack" style={{ gap: 6 }}>
          <input type="search" placeholder="Variable suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="var-list">
            {sample.loading && <small>Variablen werden geladen …</small>}
            {vars.map((v) => (
              <button type="button" key={v.path} className="var-chip" title={v.sample} onClick={() => insert(v.path)}>
                {v.path}
              </button>
            ))}
          </div>
          <small>
            Filter: <code>| date:"dd.MM.yyyy"</code> <code>| time</code> <code>| default:"-"</code> <code>| first</code> <code>| upper</code>{' '}
            <code>| strip_html</code> <code>| truncate:100</code>
          </small>
        </div>
      )}
      {preview !== null && <div className="preview">{preview || <small>(leer)</small>}</div>}
    </Field>
  );
}
