import { Link } from 'react-router-dom';
import { TOOL_META } from '../components/Layout';
import { Card, Empty, PageHeader } from '../components/ui';
import { useMe } from '../lib/auth';

export function Dashboard() {
  const { me } = useMe();
  const tools = me.tools.filter((t) => me.permissions[t.key]?.includes('view'));
  return (
    <>
      <PageHeader title={`Willkommen, ${me.user.name.split(' ')[0]}`} />
      {tools.length === 0 ? (
        <Card>
          <Empty>Dir wurden noch keine Tools freigegeben. Bitte wende dich an einen Administrator deiner Gemeinde.</Empty>
        </Card>
      ) : (
        <div className="grid grid-3">
          {tools.map((t) => (
            <Link key={t.key} to={TOOL_META[t.key].path} className="card tool-tile">
              <span className="icon">{TOOL_META[t.key].icon}</span>
              <h2 style={{ margin: 0 }}>{t.label}</h2>
              <span className="muted">{TOOL_META[t.key].description}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
