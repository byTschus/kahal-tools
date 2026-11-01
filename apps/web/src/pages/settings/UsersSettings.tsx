import { ArrowLeft, Check, Copy, Mail, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, Checkbox, ConfirmButton, Field, Modal, Spinner } from '../../components/ui';
import { api, useAction, useApi } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import type { PermissionMap } from '../../lib/types';
import { PermissionMatrix } from './PermissionMatrix';

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  status: 'active' | 'invited' | 'pending' | 'disabled';
  permissions: PermissionMap;
  groupIds: string[];
  lastLoginAt: string | null;
}

export interface GroupRow {
  id: string;
  name: string;
  permissions: PermissionMap;
  memberIds: string[];
}

export interface InviteResult {
  status: 'sent' | 'disabled' | 'no-email' | 'failed';
  error?: string;
  loginUrl: string;
}

type Message = { kind: 'success' | 'warning'; text: string; link?: string };

/** Meldung nach dem Versand einer Einladung */
function inviteMessage(name: string, email: string | null, invite: InviteResult, again = false): Message {
  const intro = again ? '' : `${name} wurde eingeladen. `;
  switch (invite.status) {
    case 'sent':
      return { kind: 'success', text: `${intro}Die Einladung mit dem Login-Link wurde an ${email} geschickt.` };
    case 'no-email':
      return { kind: 'warning', text: `${intro}Im Planungstool ist keine E-Mail-Adresse hinterlegt. Schicke ${name} den Login-Link selbst:`, link: invite.loginUrl };
    case 'failed':
      return { kind: 'warning', text: `${intro}Die E-Mail konnte nicht verschickt werden (${invite.error}). Schicke ${name} den Login-Link selbst:`, link: invite.loginUrl };
    default:
      return { kind: 'success', text: `${intro}Schicke ${name} den Login-Link, die Person hat nach der Anmeldung Zugriff:`, link: invite.loginUrl };
  }
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="row" style={{ gap: 8, marginTop: 6 }}>
      <code style={{ fontSize: '0.8rem' }}>{url}</code>
      <Button
        size="small"
        icon={copied ? Check : Copy}
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Kopiert' : 'Kopieren'}
      </Button>
    </span>
  );
}

const STATUS: Record<UserRow['status'], { label: string; color?: 'green' | 'red' | 'blue' | 'yellow' }> = {
  active: { label: 'Aktiv', color: 'green' },
  invited: { label: 'Eingeladen', color: 'blue' },
  pending: { label: 'Wartet auf Freigabe', color: 'yellow' },
  disabled: { label: 'Deaktiviert', color: 'red' },
};

export function mergePerms(...maps: PermissionMap[]): PermissionMap {
  const out: PermissionMap = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) out[k as keyof PermissionMap] = [...new Set([...(out[k as keyof PermissionMap] ?? []), ...(v ?? [])])];
  return out;
}

export function UsersSettings() {
  const { me, reload: reloadMe } = useMe();
  const { data: users, loading, error, reload } = useApi<UserRow[]>('/api/users');
  const { data: groups } = useApi<GroupRow[]>('/api/groups');
  const { data: inviteInfo } = useApi<{ mailEnabled: boolean; loginUrl: string }>('/api/users/invite-info');
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const approve = async (u: UserRow) => {
    await api.patch(`/api/users/${u.id}`, { status: 'active' });
    setMessage({ kind: 'success', text: `${u.name} wurde freigeschaltet. Vergib jetzt noch die passenden Rechte.` });
    void reload();
  };

  const resend = async (u: UserRow) => {
    setSending(u.id);
    try {
      const invite = await api.post<InviteResult>(`/api/users/${u.id}/invite-mail`);
      setMessage(inviteMessage(u.name, u.email, invite, true));
    } catch (err) {
      setMessage({ kind: 'warning', text: (err as Error).message });
    } finally {
      setSending(null);
    }
  };

  const pending = users?.filter((u) => u.status === 'pending') ?? [];

  return (
    <>
      {message && (
        <Alert kind={message.kind}>
          {message.text}
          {message.link && <CopyLink url={message.link} />}
        </Alert>
      )}
      {pending.length > 0 && (
        <Card title="Zugangsanfragen">
          {pending.map((u) => (
            <div key={u.id} className="row between" style={{ padding: '6px 0' }}>
              <div className="row">
                <Avatar name={u.name} url={u.avatarUrl} />
                <div>
                  <b>{u.name}</b>
                  <div>
                    <small>{u.email}</small>
                  </div>
                </div>
              </div>
              <div className="row">
                <Button variant="primary" size="small" icon={Check} onClick={() => approve(u)}>
                  Freischalten
                </Button>
                <ConfirmButton question={`Anfrage von ${u.name} ablehnen?`} onConfirm={async () => { await api.del(`/api/users/${u.id}`); void reload(); }}>
                  Ablehnen
                </ConfirmButton>
              </div>
            </div>
          ))}
        </Card>
      )}
      <Card
        title="Benutzer"
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setInviting(true)}>
            Person einladen
          </Button>
        }
      >
        <p className="muted">
          Neue Personen deiner Gemeinde können sich jederzeit mit ihrem Planungstool-Login anmelden und erscheinen dann als Zugangsanfrage. Eingeladene Personen
          werden beim ersten Login automatisch freigeschaltet.
        </p>
        {error && <Alert>{error.message}</Alert>}
        {loading && !users ? (
          <Spinner />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Gruppen</th>
                  <th>Letzter Login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <Avatar name={u.name} url={u.avatarUrl} />
                        <div>
                          <div className="row" style={{ gap: 8 }}>
                            <span className="cell-title">{u.name}</span>
                            {u.isAdmin && (
                              <Badge plain color="green">
                                Admin
                              </Badge>
                            )}
                          </div>
                          <div className="cell-sub">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge color={STATUS[u.status].color}>{STATUS[u.status].label}</Badge>
                    </td>
                    <td>
                      <small>{groups?.filter((g) => u.groupIds.includes(g.id)).map((g) => g.name).join(', ') || '–'}</small>
                    </td>
                    <td>
                      <small>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'nie'}</small>
                    </td>
                    <td>
                      <div className="actions">
                        {u.status === 'invited' &&
                          (inviteInfo?.mailEnabled && u.email ? (
                            <Button size="small" icon={Mail} busy={sending === u.id} onClick={() => resend(u)} title={`Einladung erneut an ${u.email} senden`}>
                              Erneut senden
                            </Button>
                          ) : (
                            inviteInfo && (
                              <Button
                                size="small"
                                icon={Copy}
                                onClick={() => setMessage({ kind: 'success', text: `Login-Link für ${u.name}:`, link: inviteInfo.loginUrl })}
                              >
                                Login-Link
                              </Button>
                            )
                          ))}
                        <Button size="small" icon={ShieldCheck} onClick={() => setEditing(u)}>
                          Rechte
                        </Button>
                        {u.id !== me.user.id && (
                          <ConfirmButton
                            question={`${u.name} entfernen?`}
                            onConfirm={async () => {
                              try {
                                await api.del(`/api/users/${u.id}`);
                                void reload();
                              } catch (err) {
                                setMessage({ kind: 'warning', text: (err as Error).message });
                              }
                            }}
                          >
                            Entfernen
                          </ConfirmButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && groups && (
        <UserModal
          user={editing}
          groups={groups}
          isSelf={editing.id === me.user.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
            if (editing.id === me.user.id) reloadMe();
          }}
        />
      )}
      {inviting && groups && (
        <InviteModal
          groups={groups}
          onClose={() => setInviting(false)}
          mailEnabled={inviteInfo?.mailEnabled ?? false}
          onInvited={(person, invite) => {
            setInviting(false);
            setMessage(inviteMessage(person.name, person.email ?? null, invite));
            void reload();
          }}
        />
      )}
    </>
  );
}

function UserModal({ user, groups, isSelf, onClose, onSaved }: { user: UserRow; groups: GroupRow[]; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [active, setActive] = useState(user.status !== 'disabled');
  const [groupIds, setGroupIds] = useState(user.groupIds);
  const [perms, setPerms] = useState<PermissionMap>(user.permissions);
  const save = useAction();
  const inherited = mergePerms(...groups.filter((g) => groupIds.includes(g.id)).map((g) => g.permissions));

  const submit = async () => {
    const ok = await save.run(() =>
      api.patch(`/api/users/${user.id}`, {
        isAdmin,
        groupIds,
        permissions: perms,
        ...(user.status === 'active' || user.status === 'disabled' ? { status: active ? 'active' : 'disabled' } : {}),
      }),
    );
    if (ok) onSaved();
  };

  return (
    <Modal
      title={`Rechte: ${user.name}`}
      onClose={onClose}
      wide
      footer={
        <Button variant="primary" busy={save.busy} onClick={submit}>
          Speichern
        </Button>
      }
    >
      <Alert>{save.error}</Alert>
      <div className="row" style={{ gap: 24 }}>
        <Checkbox checked={isAdmin} onChange={setIsAdmin} disabled={isSelf} label="Administrator (alle Rechte, Benutzerverwaltung)" />
        {(user.status === 'active' || user.status === 'disabled') && !isSelf && <Checkbox checked={active} onChange={setActive} label="Zugang aktiv" />}
      </div>
      {!isAdmin && (
        <>
          {groups.length > 0 && (
            <Field label="Gruppen">
              <div className="row">
                {groups.map((g) => (
                  <Checkbox
                    key={g.id}
                    checked={groupIds.includes(g.id)}
                    onChange={(on) => setGroupIds(on ? [...groupIds, g.id] : groupIds.filter((id) => id !== g.id))}
                    label={g.name}
                  />
                ))}
              </div>
            </Field>
          )}
          <Field label="Persönliche Rechte" hint="Hell dargestellte Häkchen stammen aus Gruppen.">
            <PermissionMatrix value={perms} onChange={setPerms} inherited={inherited} />
          </Field>
        </>
      )}
    </Modal>
  );
}

interface Person {
  externalId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  alreadyAdded: boolean;
}

function InviteModal({
  groups,
  mailEnabled,
  onClose,
  onInvited,
}: {
  groups: GroupRow[];
  mailEnabled: boolean;
  onClose: () => void;
  onInvited: (person: Person, invite: InviteResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [perms, setPerms] = useState<PermissionMap>({});
  const save = useAction();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  const { data: people, loading, error } = useApi<Person[]>(debounced.length >= 2 ? `/api/users/search-people?q=${encodeURIComponent(debounced)}` : null);

  const submit = async () => {
    if (!person) return;
    const res = await save.run(() =>
      api.post<{ invite: InviteResult }>('/api/users/invite', {
        externalPersonId: person.externalId,
        name: person.name,
        email: person.email ?? null,
        avatarUrl: person.avatarUrl ?? null,
        groupIds,
        permissions: perms,
      }),
    );
    if (res) onInvited(person, res.invite);
  };

  return (
    <Modal
      title="Person aus dem Planungstool einladen"
      onClose={onClose}
      wide
      footer={
        person ? (
          <>
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setPerson(null)}>
              Andere Person
            </Button>
            <Button variant="primary" icon={mailEnabled && person.email ? Mail : undefined} busy={save.busy} onClick={submit}>
              {mailEnabled && person.email ? 'Einladen und E-Mail senden' : 'Einladen'}
            </Button>
          </>
        ) : null
      }
    >
      <Alert>{save.error ?? error?.message}</Alert>
      {!person ? (
        <>
          <div className="search">
            <Search size={15} />
            <input type="search" autoFocus placeholder="Name oder E-Mail suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {loading && <Spinner />}
          <div className="scroll-list">
            {people?.map((p) => (
              <button key={p.externalId} className="list-item" disabled={p.alreadyAdded} onClick={() => setPerson(p)} style={p.alreadyAdded ? { opacity: 0.5 } : undefined}>
                <Avatar name={p.name} url={p.avatarUrl} />
                <div style={{ flex: 1 }}>
                  <b>{p.name}</b>
                  <div>
                    <small>{p.email}</small>
                  </div>
                </div>
                {p.alreadyAdded && <Badge>bereits vorhanden</Badge>}
              </button>
            ))}
            {people && people.length === 0 && <div className="empty">Niemand gefunden</div>}
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <Avatar name={person.name} url={person.avatarUrl} />
            <div>
              <b>{person.name}</b>
              <div>
                <small>{person.email}</small>
              </div>
            </div>
          </div>
          {groups.length > 0 && (
            <Field label="Gruppen">
              <div className="row">
                {groups.map((g) => (
                  <Checkbox key={g.id} checked={groupIds.includes(g.id)} onChange={(on) => setGroupIds(on ? [...groupIds, g.id] : groupIds.filter((id) => id !== g.id))} label={g.name} />
                ))}
              </div>
            </Field>
          )}
          <Field label="Persönliche Rechte">
            <PermissionMatrix value={perms} onChange={setPerms} inherited={mergePerms(...groups.filter((g) => groupIds.includes(g.id)).map((g) => g.permissions))} />
          </Field>
        </>
      )}
    </Modal>
  );
}
