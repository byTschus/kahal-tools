import { createContext, useContext, type ReactNode } from 'react';
import type { ActionKey, Me, ToolKey } from './types';

const MeContext = createContext<{ me: Me; reload: () => void } | null>(null);

export function MeProvider({ me, reload, children }: { me: Me; reload: () => void; children: ReactNode }) {
  return <MeContext.Provider value={{ me, reload }}>{children}</MeContext.Provider>;
}

export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe außerhalb von MeProvider');
  return ctx;
}

/** Prüft ein Recht des angemeldeten Benutzers */
export function useCan() {
  const { me } = useMe();
  return (tool: ToolKey, action: ActionKey) => Boolean(me.permissions[tool]?.includes(action));
}
