import { useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, ConfirmButton, Empty, Field, Modal, Spinner } from '../../components/ui';
import { api, useAction, useApi } from '../../lib/api';
import { useMe } from '../../lib/auth';
import type { PermissionMap } from '../../lib/types';
import { PermissionMatrix } from './PermissionMatrix';
import type { GroupRow, UserRow } from './UsersSettings';

export function GroupsSettings() {
  const { me } = useMe();
  const { data: groups, loading, reload } = useApi<GroupRow[]>('/api/groups');
  const { data: users } = useApi<UserRow[]>('/api/users');
  const [editing, setEditing] = useState<GroupRow | 'new' | null>(null);

  const summary = (p: PermissionMap) =>
    me.tools
      .filter((t) => p[t.key]?.length)
      .map((t) => `${t.label} (${p[t.key]!.length})`)
      .join(', ') || 'keine Rechte';

  return (
    <Card
      title="Gruppen"
      actions={
        <Button variant="primary" onClick={() => setEditing('new')}>
          ＋ Neue Gruppe
        </Button>
      }
    >
      <p className="muted">Gruppen bündeln Rechte, z.B. „Technik-Team“ oder „Empfang“. Mitglieder erhalten alle Rechte ihrer Gruppen.</p>
      {loading && !groups ? (
        <Spinner />
      ) : !groups?.length ? (
        <Empty>Noch keine Gruppen.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Rechte</th>
              <th>Mitglieder</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <b>{g.name}</b>
                </td>
                <td>
                  <small>{summary(g.permissions)}</small>
                </td>
                <td>
                  <Badge>{g.memberIds.length}</Badge>
                </td>
                <td>
                  <div className="actions">
                    <Button size="small" onClick={() => setEditing(g)}>
                      Bearbeiten
                    </Button>
                    <ConfirmButton
                      question={`Gruppe „${g.name}“ löschen?`}
                      onConfirm={async () => {
                        await api.del(`/api/groups/${g.id}`);
                        void reload();
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && users && (
        <GroupModal
          group={editing === 'new' ? null : editing}
          users={users.filter((u) => !u.isAdmin && u.status !== 'pending')}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </Card>
  );
}

function GroupModal({ group, users, onClose, onSaved }: { group: GroupRow | null; users: UserRow[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [perms, setPerms] = useState<PermissionMap>(group?.permissions ?? {});
  const [memberIds, setMemberIds] = useState<string[]>(group?.memberIds ?? []);
  const save = useAction();

  const submit = async () => {
    const body = { name, permissions: perms, memberIds };
    const ok = await save.run(() => (group ? api.patch(`/api/groups/${group.id}`, body) : api.post('/api/groups', body)));
    if (ok) onSaved();
  };

  return (
    <Modal
      title={group ? `Gruppe: ${group.name}` : 'Neue Gruppe'}
      onClose={onClose}
      wide
      footer={
        <Button variant="primary" busy={save.busy} onClick={submit} disabled={!name.trim()}>
          Speichern
        </Button>
      }
    >
      <Alert>{save.error}</Alert>
      <Field label="Name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Rechte">
        <PermissionMatrix value={perms} onChange={setPerms} />
      </Field>
      <Field label="Mitglieder" hint="Administratoren haben ohnehin alle Rechte und werden hier nicht angezeigt.">
        <div className="grid grid-3" style={{ gap: 6 }}>
          {users.map((u) => (
            <Checkbox key={u.id} checked={memberIds.includes(u.id)} onChange={(on) => setMemberIds(on ? [...memberIds, u.id] : memberIds.filter((id) => id !== u.id))} label={u.name} />
          ))}
        </div>
      </Field>
    </Modal>
  );
}
