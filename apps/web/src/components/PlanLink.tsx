import { CalendarDays, Unlink } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '../lib/format';
import type { PlanningEvent } from '../lib/types';
import { EventPicker, type PlanTool } from './EventPicker';
import { Button, Modal } from './ui';

export interface PlanRef {
  id: string;
  title: string | null;
  startsAt?: string | null;
}

/** Zeigt den verknüpften Plan und erlaubt Wählen, Ändern und Lösen der Verknüpfung */
export function PlanLink({
  tool,
  ownId,
  value,
  onChange,
  required,
}: {
  tool: PlanTool;
  ownId?: string | null;
  value: PlanRef | null;
  onChange: (plan: PlanRef | null) => void;
  required?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="row between" style={{ flexWrap: 'nowrap' }}>
      <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
        <CalendarDays size={16} style={{ flex: 'none', color: 'var(--muted)' }} />
        {value ? (
          <span style={{ minWidth: 0 }}>
            {value.title ?? 'Plan'} {value.startsAt && <small>({fmtDate(value.startsAt, false)})</small>}
          </span>
        ) : (
          <small>Kein Plan verknüpft</small>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <Button size="small" onClick={() => setPicking(true)}>
          {value ? 'Ändern' : 'Plan wählen'}
        </Button>
        {value && !required && <Button size="small" variant="ghost" icon={Unlink} title="Verknüpfung lösen" aria-label="Verknüpfung lösen" onClick={() => onChange(null)} />}
      </div>
      {picking && (
        <Modal title="Plan auswählen" wide onClose={() => setPicking(false)}>
          <EventPicker
            tool={tool}
            ownId={ownId}
            defaultRange="past"
            value={value?.id ?? null}
            onChange={(ev: PlanningEvent) => {
              setPicking(false);
              onChange({ id: ev.id, title: ev.title, startsAt: ev.startsAt });
            }}
          />
        </Modal>
      )}
    </div>
  );
}
