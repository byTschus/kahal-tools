import { ArrowRight, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TOOL_META } from '../components/Layout';
import { Card, Empty, PageHeader } from '../components/ui';
import { useMe } from '../lib/auth';

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

export function Dashboard() {
  const { me } = useMe();
  const tools = me.tools.filter((t) => me.permissions[t.key]?.includes('view'));
  return (
    <>
      <PageHeader title={`${greeting()}, ${me.user.name.split(' ')[0]}`} description={me.tenant.name} />
      {tools.length === 0 ? (
        <Card>
          <Empty icon={Lock} title="Noch keine Tools freigegeben">
            Ein Administrator deiner Gemeinde kann dir Zugriff geben.
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-3">
          {tools.map((t) => {
            const Icon = TOOL_META[t.key].icon;
            return (
              <Link key={t.key} to={TOOL_META[t.key].path} className="card tool-tile">
                <span className="icon-tile">
                  <Icon size={20} strokeWidth={1.8} />
                </span>
                <ArrowRight className="go" size={18} />
                <h2>{t.label}</h2>
                <span className="muted">{TOOL_META[t.key].description}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
