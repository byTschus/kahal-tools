import { Check, Link2, Search } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../lib/api';
import { fmtDate } from '../lib/format';
import type { PlanningEvent } from '../lib/types';
import { Alert, Spinner, Tabs } from './ui';

export type PlanTool = 'livestream' | 'podcast' | 'visitors';

/**
 * Auswahl eines Events / Plans aus dem Planungstool.
 * Mit `tool` werden Pläne, die schon einem anderen Eintrag dieses Tools gehören, gesperrt
 * (ein Plan kann pro Tool nur einem Eintrag zugeordnet sein); `ownId` = der gerade bearbeitete Eintrag.
 */
export function EventPicker({
  value,
  onChange,
  defaultRange = 'upcoming',
  tool,
  ownId,
}: {
  value: string | null;
  onChange: (event: PlanningEvent) => void;
  defaultRange?: 'upcoming' | 'past';
  tool?: PlanTool;
  ownId?: string | null;
}) {
  const [range, setRange] = useState<'upcoming' | 'past'>(defaultRange);
  const [filter, setFilter] = useState('');
  const { data, loading, error } = useApi<PlanningEvent[]>(`/api/planning/events?range=${range}${tool ? `&tool=${tool}` : ''}`);
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
        <div className="search" style={{ maxWidth: 240, flex: 1 }}>
          <Search size={15} />
          <input type="search" placeholder="Suchen" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {error && <Alert>{error.message}</Alert>}
      {loading ? (
        <Spinner label="Pläne werden geladen …" />
      ) : (
        <div className="scroll-list">
          {list.length === 0 && <div className="empty">Keine Pläne gefunden</div>}
          {list.map((e) => {
            const taken = e.linked && e.linked.id !== ownId && value !== e.id ? e.linked : null;
            return (
              <button
                key={e.id}
                type="button"
                className={`list-item ${value === e.id ? 'selected' : ''}`}
                disabled={Boolean(taken)}
                style={taken ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                onClick={() => onChange(e)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-title">{e.title}</div>
                  <div className="cell-sub">
                    {fmtDate(e.startsAt)} {e.sourceName ? `· ${e.sourceName}` : ''}
                  </div>
                  {taken && (
                    <div className="cell-sub row" style={{ gap: 4 }}>
                      <Link2 size={12} /> Bereits verknüpft: {taken.title}
                    </div>
                  )}
                </div>
                {value === e.id && <Check className="check" size={18} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
