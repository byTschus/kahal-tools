import { useMe } from '../../lib/auth';
import type { ActionKey, PermissionMap, ToolKey } from '../../lib/types';

/** Tabelle Tools × Aktionen zum Vergeben von Rechten */
export function PermissionMatrix({
  value,
  onChange,
  inherited,
  disabled,
}: {
  value: PermissionMap;
  onChange: (v: PermissionMap) => void;
  /** Rechte, die bereits über Gruppen vorhanden sind (werden angezeigt, aber nicht bearbeitet) */
  inherited?: PermissionMap;
  disabled?: boolean;
}) {
  const { me } = useMe();
  const has = (map: PermissionMap | undefined, t: ToolKey, a: ActionKey) => Boolean(map?.[t]?.includes(a));

  const toggle = (tool: ToolKey, action: ActionKey, on: boolean) => {
    let actions = new Set(value[tool] ?? []);
    if (on) {
      actions.add(action);
      actions.add('view');
    } else if (action === 'view') {
      actions = new Set();
    } else {
      actions.delete(action);
    }
    onChange({ ...value, [tool]: [...actions] });
  };

  const toggleTool = (tool: ToolKey, on: boolean) => onChange({ ...value, [tool]: on ? me.actions.map((a) => a.key) : [] });

  return (
    <div className="table-wrap">
      <table className="perm-table">
        <thead>
          <tr>
            <th>Tool</th>
            {me.actions.map((a) => (
              <th key={a.key}>{a.label}</th>
            ))}
            <th>Alle</th>
          </tr>
        </thead>
        <tbody>
          {me.tools.map((t) => (
            <tr key={t.key}>
              <td>{t.label}</td>
              {me.actions.map((a) => {
                const viaGroup = has(inherited, t.key, a.key) && !has(value, t.key, a.key);
                return (
                  <td key={a.key} title={viaGroup ? 'Über Gruppe vergeben' : undefined}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={has(value, t.key, a.key) || viaGroup}
                      style={viaGroup ? { opacity: 0.45 } : undefined}
                      onChange={(e) => toggle(t.key, a.key, e.target.checked)}
                    />
                  </td>
                );
              })}
              <td>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={me.actions.every((a) => has(value, t.key, a.key))}
                  onChange={(e) => toggleTool(t.key, e.target.checked)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
