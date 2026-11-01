import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import type { ToolKey } from '../lib/types';
import { Avatar } from './ui';

export const TOOL_META: Record<ToolKey, { icon: string; path: string; description: string }> = {
  livestream: { icon: '📡', path: '/livestream', description: 'Livestreams aus Plänen erstellen und verwalten' },
  podcast: { icon: '🎙️', path: '/podcast', description: 'Podcasts aus vergangenen Streams schneiden und veröffentlichen' },
  visitors: { icon: '👥', path: '/visitors', description: 'Besucher erfassen und auswerten' },
};

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
        <span className="brand" style={{ padding: 0 }}>
          <img src="/favicon.svg" alt="" /> kahal.tools
        </span>
        <button className="btn small" onClick={() => setOpen(true)} aria-label="Menü">
          ☰
        </button>
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <a href="/" className="brand">
          <img src="/favicon.svg" alt="" /> kahal.tools
        </a>
        <div className="tenant">{me.tenant.name}</div>
        <NavLink to="/" end className="nav-link">
          🏠 Übersicht
        </NavLink>
        {visibleTools.map((t) => (
          <NavLink key={t.key} to={TOOL_META[t.key].path} className="nav-link">
            {TOOL_META[t.key].icon} {t.label}
          </NavLink>
        ))}
        {canSettings && (
          <NavLink to="/settings" className={`nav-link ${location.pathname.startsWith('/settings') ? 'active' : ''}`}>
            ⚙️ Einstellungen
          </NavLink>
        )}
        <div className="nav-spacer" />
        <div className="user-box">
          <Avatar name={me.user.name} url={me.user.avatarUrl} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.user.name}</div>
            <small>{me.user.isAdmin ? 'Administrator' : 'Benutzer'}</small>
          </div>
          <button className="btn small ghost" onClick={logout} title="Abmelden">
            ⎋
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
