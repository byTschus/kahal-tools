import { LayoutGrid, LogOut, Menu, Mic, Radio, Settings, Users, X, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import type { ToolKey } from '../lib/types';
import { Brand } from './Brand';
import { Avatar, Button } from './ui';

export const TOOL_META: Record<ToolKey, { icon: LucideIcon; path: string; description: string }> = {
  livestream: { icon: Radio, path: '/livestream', description: 'Streams aus dem Plan anlegen und verwalten' },
  podcast: { icon: Mic, path: '/podcast', description: 'Predigten aus Streams schneiden und veröffentlichen' },
  visitors: { icon: Users, path: '/visitors', description: 'Besucher erfassen und auswerten' },
};

function NavItem({ to, icon: Icon, children, end, active }: { to: string; icon: LucideIcon; children: ReactNode; end?: boolean; active?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive || active ? 'active' : ''}`}>
      <Icon size={18} strokeWidth={1.8} />
      {children}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const visibleTools = me.tools.filter((t) => me.permissions[t.key]?.includes('view'));
  const canSettings = me.user.isAdmin || Object.values(me.permissions).some((a) => a?.includes('settings'));

  const logout = async () => {
    await api.post('/auth/logout');
    window.location.href = `/login/${me.tenant.slug}`;
  };

  return (
    <div className="app">
      <div className="mobile-bar">
        <Brand />
        <Button variant="ghost" icon={Menu} onClick={() => setOpen(true)} aria-label="Menü öffnen" />
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="row between" style={{ flexWrap: 'nowrap' }}>
          <Brand subtitle={me.tenant.name} />
          {open && <Button variant="ghost" icon={X} aria-label="Menü schliessen" />}
        </div>
        <NavItem to="/" end icon={LayoutGrid}>
          Übersicht
        </NavItem>
        {visibleTools.length > 0 && <div className="nav-section">Tools</div>}
        {visibleTools.map((t) => (
          <NavItem key={t.key} to={TOOL_META[t.key].path} icon={TOOL_META[t.key].icon}>
            {t.label}
          </NavItem>
        ))}
        {canSettings && (
          <>
            <div className="nav-section">Verwaltung</div>
            <NavItem to="/settings" icon={Settings} active={location.pathname.startsWith('/settings')}>
              Einstellungen
            </NavItem>
          </>
        )}
        <div className="nav-spacer" />
        <div className="user-box">
          <Avatar name={me.user.name} url={me.user.avatarUrl} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="name">{me.user.name}</div>
            <small>{me.user.isAdmin ? 'Administrator' : 'Mitarbeitende'}</small>
          </div>
          <Button variant="ghost" size="small" icon={LogOut} onClick={logout} title="Abmelden" aria-label="Abmelden" />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
