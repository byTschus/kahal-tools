import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useApi } from './lib/api';
import { MeProvider } from './lib/auth';
import { setTimeZone } from './lib/format';
import type { Me } from './lib/types';
import { Dashboard } from './pages/Dashboard';
import { LivestreamPage } from './pages/LivestreamPage';
import { LoginPage, PendingPage } from './pages/Login';
import { PodcastCreatePage } from './pages/PodcastCreatePage';
import { PodcastPage } from './pages/PodcastPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { VisitorsPage } from './pages/VisitorsPage';

export function App() {
  const location = useLocation();
  const isPublic = location.pathname === '/login';
  const { data: me, error, loading, reload } = useApi<Me>(isPublic ? null : '/api/me');

  useEffect(() => {
    if (me) setTimeZone(me.tenant.timeZone);
  }, [me]);

  if (isPublic) return <LoginPage />;
  if (loading && !me) return <Spinner />;
  if (error?.status === 401 || !me) return <Navigate to="/login" replace />;
  if (me.user.status !== 'active') return <PendingPage me={me} />;

  return (
    <MeProvider me={me} reload={reload}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/livestream" element={<LivestreamPage />} />
          <Route path="/podcast" element={<PodcastPage />} />
          <Route path="/podcast/new" element={<PodcastCreatePage />} />
          <Route path="/visitors" element={<VisitorsPage />} />
          <Route path="/settings/:tab?" element={<SettingsPage />} />
          <Route path="/pending" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </MeProvider>
  );
}
