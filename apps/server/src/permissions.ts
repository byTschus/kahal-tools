/**
 * Rechte-System: Jedes Tool hat Aktionen. Ein Benutzer erhält Rechte direkt und/oder über Gruppen.
 * Admins haben immer alle Rechte und dürfen Benutzer/Gruppen verwalten.
 *
 * Neues Tool? -> Hier in TOOLS eintragen.
 */
export const TOOLS = [
  { key: 'livestream', label: 'Livestream' },
  { key: 'podcast', label: 'Podcast' },
  { key: 'visitors', label: 'Besucherzähler' },
] as const;

export const ACTIONS = [
  { key: 'view', label: 'Ansehen' },
  { key: 'create', label: 'Erstellen' },
  { key: 'edit', label: 'Bearbeiten' },
  { key: 'delete', label: 'Löschen' },
  { key: 'settings', label: 'Einstellungen' },
] as const;

export type ToolKey = (typeof TOOLS)[number]['key'];
export type ActionKey = (typeof ACTIONS)[number]['key'];
export type PermissionMap = Partial<Record<ToolKey, ActionKey[]>>;

const toolKeys = new Set<string>(TOOLS.map((t) => t.key));
const actionKeys = new Set<string>(ACTIONS.map((a) => a.key));

/** Bereinigt eine beliebige Eingabe zu einer gültigen PermissionMap. */
export function sanitizePermissions(input: unknown): PermissionMap {
  const out: PermissionMap = {};
  if (!input || typeof input !== 'object') return out;
  for (const [tool, actions] of Object.entries(input as Record<string, unknown>)) {
    if (!toolKeys.has(tool) || !Array.isArray(actions)) continue;
    const valid = [...new Set(actions.filter((a): a is ActionKey => typeof a === 'string' && actionKeys.has(a)))];
    // Wer etwas darf, darf das Tool auch ansehen
    if (valid.length && !valid.includes('view')) valid.unshift('view');
    if (valid.length) out[tool as ToolKey] = valid;
  }
  return out;
}

export function mergePermissions(...maps: PermissionMap[]): PermissionMap {
  const out: PermissionMap = {};
  for (const map of maps) {
    for (const [tool, actions] of Object.entries(map) as [ToolKey, ActionKey[]][]) {
      out[tool] = [...new Set([...(out[tool] ?? []), ...actions])];
    }
  }
  return out;
}

export function allPermissions(): PermissionMap {
  return Object.fromEntries(TOOLS.map((t) => [t.key, ACTIONS.map((a) => a.key)])) as PermissionMap;
}

export function effectivePermissions(user: {
  isAdmin: boolean;
  permissions: unknown;
  groups?: { group: { permissions: unknown } }[];
}): PermissionMap {
  if (user.isAdmin) return allPermissions();
  return mergePermissions(
    sanitizePermissions(user.permissions),
    ...(user.groups ?? []).map((g) => sanitizePermissions(g.group.permissions)),
  );
}

export function can(perms: PermissionMap, tool: ToolKey, action: ActionKey) {
  return perms[tool]?.includes(action) ?? false;
}
