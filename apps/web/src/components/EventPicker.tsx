import { useState } from 'react';
import { useApi } from '../lib/api';
import { fmtDate } from '../lib/format';
import type { PlanningEvent } from '../lib/types';
import { Alert, Spinner, Tabs } from './ui';

/** Auswahl eines Events / Plans aus dem Planungstool */
export function EventPicker({
  value,
  onChange,
  defaultRange = 'upcoming',
}: {
  value: string | null;
  onChange: (event: PlanningEvent) => void;
  defaultRange?: 'upcoming' | 'past';
}) {
  const [range, setRange] = useState<'upcoming' | 'past'>(defaultRange);
  const [filter, setFilter] = useState('');
  const { data, loading, error } = useApi<PlanningEvent[]>(`/api/planning/events?range=${range}`);
  const list = (data ?? []).filter((e) => !filter || `${e.title} ${e.subtitle ?? ''} ${e.sourceName ?? ''}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between">
        <Tabs
          tabs={[
            { key: 'upcoming', label: 'Kommende' },
            { key: 'past', label: 'Vergangene' },
          ]}
          value={range}
          onChange={setRange}
        />
        <input type="search" placeholder="Suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      {error && <Alert>{error.message}</Alert>}
      {loading ? (
        <Spinner label="Pläne werden geladen …" />
      ) : (
        <div className="scroll-list">
          {list.length === 0 && <div className="empty">Keine Pläne gefunden</div>}
          {list.map((e) => (
            <button key={e.id} type="button" className={`list-item ${value === e.id ? 'selected' : ''}`} onClick={() => onChange(e)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{e.title}</div>
                <small>
                  {fmtDate(e.startsAt)} {e.sourceName ? `· ${e.sourceName}` : ''}
                </small>
              </div>
              {value === e.id && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
