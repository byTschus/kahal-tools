import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, Tabs } from '../../components/ui';
import { useCan, useMe } from '../../lib/auth';
import { GroupsSettings } from './GroupsSettings';
import { LivestreamSettings } from './LivestreamSettings';
import { PlanningSettings } from './PlanningSettings';
import { PodcastSettings } from './PodcastSettings';
import { UsersSettings } from './UsersSettings';
import { VisitorSettings } from './VisitorSettings';

type TabKey = 'users' | 'groups' | 'planning' | 'livestream' | 'podcast' | 'visitors';

export function SettingsPage() {
  const { me } = useMe();
  const can = useCan();
  const navigate = useNavigate();
  const { tab } = useParams();
  const admin = me.user.isAdmin;

  const tabs: { key: TabKey; label: string; visible: boolean }[] = [
    { key: 'users', label: 'Benutzer', visible: admin },
    { key: 'groups', label: 'Gruppen', visible: admin },
    { key: 'planning', label: 'Planungstool', visible: admin },
    { key: 'livestream', label: 'Livestream', visible: can('livestream', 'settings') },
    { key: 'podcast', label: 'Podcast', visible: can('podcast', 'settings') },
    { key: 'visitors', label: 'Besucherzähler', visible: can('visitors', 'settings') },
  ];
  const visible = tabs.filter((t) => t.visible);
  if (!visible.length) return <Navigate to="/" replace />;
  const current = (visible.find((t) => t.key === tab) ?? visible[0]).key;

  return (
    <>
      <PageHeader title="Einstellungen" description="Benutzer, Rechte und die Einstellungen der einzelnen Tools." />
      <Tabs variant="underline" tabs={visible} value={current} onChange={(k) => navigate(`/settings/${k}`)} />
      {current === 'users' && <UsersSettings />}
      {current === 'groups' && <GroupsSettings />}
      {current === 'planning' && <PlanningSettings />}
      {current === 'livestream' && <LivestreamSettings />}
      {current === 'podcast' && <PodcastSettings />}
      {current === 'visitors' && <VisitorSettings />}
    </>
  );
}
