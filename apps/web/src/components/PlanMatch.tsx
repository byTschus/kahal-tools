import { CalendarCheck } from 'lucide-react';
import { fmtDate } from '../lib/format';
import { Alert, Badge } from './ui';

/** Ergebnis der automatischen Plan-Zuordnung beim Import */
export interface MatchedPlan {
  planId: string;
  title: string;
  startsAt: string | null;
}

export interface MatchingSummary {
  error?: string;
  linked: number;
  ambiguous: number;
}

export const MATCH_LABEL = 'Neue Einträge automatisch einem Plan zuordnen (nach Datum, der Titel hilft bei Abweichungen)';

/** Zugeordneter Plan eines Eintrags in der Import-Vorschau */
export function PlanMatchBadge({ plan, ambiguous }: { plan: MatchedPlan | null | undefined; ambiguous?: boolean }) {
  if (plan)
    return (
      <span className="row" style={{ gap: 4, flexWrap: 'nowrap', minWidth: 0 }} title={`Plan: ${plan.title}${plan.startsAt ? ` (${fmtDate(plan.startsAt)})` : ''}`}>
        <CalendarCheck size={14} style={{ flex: 'none', color: 'var(--accent-text)' }} />
        <small style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {plan.title}
          {plan.startsAt && <span className="muted"> · {fmtDate(plan.startsAt, false)}</span>}
        </small>
      </span>
    );
  if (ambiguous)
    return (
      <Badge color="yellow" plain>
        nicht eindeutig
      </Badge>
    );
  return <small className="muted">kein Plan</small>;
}

/** Zusammenfassung: wie viele neue Einträge einem Plan zugeordnet werden */
export function MatchingInfo({ matching, total }: { matching: MatchingSummary; total: number }) {
  if (matching.error) return <Alert kind="warning">{matching.error} – die Einträge werden ohne Plan importiert.</Alert>;
  return (
    <div>
      {matching.linked} von {total} neuen Einträgen werden einem Plan zugeordnet
      {matching.ambiguous ? `, ${matching.ambiguous} sind nicht eindeutig und bleiben ohne Plan` : ''}. Weitere Pläne kannst du später beim Bearbeiten verknüpfen.
    </div>
  );
}
