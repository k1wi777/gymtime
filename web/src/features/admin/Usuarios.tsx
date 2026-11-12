'use client';

import { useId, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError, issuesByField } from '@/api/errors';
import type { Account } from '@/api/types';
import { useAuth } from '@/auth/auth-provider';
import { formatDateTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import type { FieldErrors } from '@/lib/validators';
import { Avatar } from '@/ui/Avatar';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { FormActions, SelectField, TextField, useForm } from '@/ui/Form';
import { FormModal } from '@/ui/FormModal';
import { Icon } from '@/ui/icons';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { Spinner } from '@/ui/Spinner';
import { BoardCard } from './BoardCard';
import styles from './Admin.module.css';

const ROLE_LABELS = { admin: 'Administrador', asistente: 'Asistente' } as const;
/** Same rule as the server, which lowercases and trims before checking. */
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,49}$/;

interface UserValues {
  name: string;
  username: string;
  role: string;
}

export function validateUser(
  creating: boolean,
): (values: UserValues) => FieldErrors<UserValues> {
  return (values) => {
    const errors: FieldErrors<UserValues> = {};
    if (values.name.trim() === '') errors.name = 'Escriba el nombre.';
    if (creating && !USERNAME.test(values.username.trim().toLowerCase())) {
      errors.username =
        'Use de 3 a 50 caracteres: letras, números, punto, guion o guion bajo; empiece con letra o número.';
    }
    if (values.role === '') errors.role = 'Elija el rol.';
    return errors;
  };
}

interface TemporaryPassword {
  username: string;
  password: string;
}

function UserForm({
  user,
  onSaved,
  onCancel,
}: {
  user: Account | null;
  onSaved: (temporary: TemporaryPassword | null) => void;
  onCancel: () => void;
}) {
  const creating = user === null;
  const formId = useId();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<UserValues>({
    initial: {
      name: user?.name ?? '',
      username: user?.username ?? '',
      role: user?.role ?? '',
    },
    validate: validateUser(creating),
    onSubmit: async (values) => {
      setFailure(null);
      const role = values.role as Account['role'];
      try {
        if (user) {
          await call(
            getApi().client.PATCH('/users/{id}', {
              params: { path: { id: user.id } },
              body: { name: values.name.trim(), role },
            }),
          );
          onSaved(null);
        } else {
          const created = await call(
            getApi().client.POST('/users', {
              body: {
                name: values.name.trim(),
                username: values.username.trim(),
                role,
              },
            }),
          );
          onSaved({
            username: created.username,
            password: created.temporaryPassword,
          });
        }
      } catch (error) {
        form.setServerErrors(issuesByField(error));
        setFailure(describeError(error));
      }
    },
  });
  return (
    <form
      id={formId}
      className="stack"
      onSubmit={form.submit}
      noValidate
      aria-label={creating ? 'Nuevo usuario' : `Editar ${user.name}`}
    >
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      <TextField
        label="Nombre"
        value={form.values.name}
        onChange={(v) => form.setValue('name', v)}
        onBlur={() => form.blur('name')}
        error={form.errors.name}
      />
      <TextField
        label="Usuario"
        value={form.values.username}
        onChange={(v) => form.setValue('username', v)}
        onBlur={() => form.blur('username')}
        error={form.errors.username}
        disabled={!creating}
        autoComplete="off"
      />
      <SelectField
        label="Rol"
        placeholder="Elija un rol"
        value={form.values.role}
        onChange={(v) => form.setValue('role', v)}
        onBlur={() => form.blur('role')}
        error={form.errors.role}
        options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
          value,
          label,
        }))}
      />
      {creating && (
        <p className="muted">
          Se genera una contraseña temporal que se muestra una sola vez; la
          persona deberá cambiarla al entrar.
        </p>
      )}
      <FormActions
        formId={formId}
        busy={form.submitting}
        submitLabel={creating ? 'Crear usuario' : 'Guardar cambios'}
        onCancel={onCancel}
      />
    </form>
  );
}

type Pending =
  { kind: 'reset'; user: Account } | { kind: 'deactivate'; user: Account };

export function Usuarios() {
  const { account } = useAuth();
  const users = useResource(
    (signal) => call(getApi().client.GET('/users', { signal })),
    [],
  );
  const [mode, setMode] = useState<'none' | 'new' | { edit: Account }>('none');
  const editing = typeof mode === 'object' ? mode.edit : null;
  const [temporary, setTemporary] = useState<TemporaryPassword | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      users.reload();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const activate = (user: Account) =>
    act(async () => {
      await call(
        getApi().client.PATCH('/users/{id}', {
          params: { path: { id: user.id } },
          body: { active: true },
        }),
      );
    });

  return (
    <div>
      <PageHeader
        crumb="Usuarios del panel"
        title="Usuarios del panel"
        lead="Quién puede entrar al panel y con qué rol."
        aside={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMode('new')}
          >
            <Icon name="mas" size={17} strokeWidth={2} />
            Nuevo usuario
          </button>
        }
      />
      <div className={styles.main}>
        {failure && (
          <Notice kind="error" onDismiss={() => setFailure(null)}>
            {failure}
          </Notice>
        )}
        <FormModal
          open={mode === 'new'}
          title="Nuevo usuario"
          onClose={() => setMode('none')}
        >
          <UserForm
            user={null}
            onCancel={() => setMode('none')}
            onSaved={(password) => {
              setMode('none');
              setTemporary(password);
              users.reload();
            }}
          />
        </FormModal>
        <FormModal
          open={editing !== null}
          title={editing ? `Editar ${editing.name}` : ''}
          onClose={() => setMode('none')}
        >
          {editing && (
            <UserForm
              key={editing.id}
              user={editing}
              onCancel={() => setMode('none')}
              onSaved={() => {
                setMode('none');
                users.reload();
              }}
            />
          )}
        </FormModal>
        {users.loading && !users.data && <Spinner />}
        {users.error ? (
          <Notice kind="error">{describeError(users.error)}</Notice>
        ) : null}
        <div className={styles.split}>
          {users.data && (
            <div className={styles.splitMain}>
              <BoardCard label="Usuarios" minWidth={720} tight>
                <caption className="visually-hidden">
                  Usuarios del panel
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Usuario</th>
                    <th scope="col">Rol</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Último ingreso</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody className={styles.roomy}>
                  {users.data.map((user) => {
                    const self = user.id === account?.id;
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className={styles.person}>
                            <Avatar
                              name={user.name}
                              id={user.id}
                              size={38}
                              fontSize={14}
                            />
                            <div>
                              <div className={styles.strong}>{user.name}</div>
                              {self && (
                                <Badge tone="info" size="xs">
                                  Usted
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.username}>
                            {user.username}
                          </span>
                        </td>
                        <td>
                          <Badge
                            tone={user.role === 'admin' ? 'success' : 'neutral'}
                          >
                            {ROLE_LABELS[user.role]}
                          </Badge>
                        </td>
                        <td>
                          <span
                            className={
                              user.active
                                ? styles.state
                                : `${styles.state} ${styles.stateOff}`
                            }
                          >
                            <span
                              aria-hidden="true"
                              className={styles.stateDot}
                            />
                            {user.active ? 'Activo' : 'Inactivo'}
                          </span>{' '}
                          {user.mustChangePassword && (
                            <Badge tone="warning">
                              Debe cambiar la contraseña
                            </Badge>
                          )}
                        </td>
                        <td className={styles.time}>
                          {user.lastLoginAt
                            ? formatDateTime(user.lastLoginAt)
                            : '—'}
                        </td>
                        <td>
                          <div className={styles.wrapActions}>
                            <button
                              type="button"
                              className="btn btn-s"
                              aria-label={`Editar a ${user.name}`}
                              onClick={() => setMode({ edit: user })}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn-s"
                              aria-label={`Restablecer contraseña de ${user.name}`}
                              onClick={() =>
                                setPending({ kind: 'reset', user })
                              }
                            >
                              Restablecer contraseña
                            </button>
                            {user.active ? (
                              <button
                                type="button"
                                className="btn btn-s btn-outline-danger"
                                aria-label={`Desactivar a ${user.name}`}
                                disabled={self}
                                title={
                                  self
                                    ? 'No puede desactivar su propia cuenta'
                                    : undefined
                                }
                                onClick={() =>
                                  setPending({ kind: 'deactivate', user })
                                }
                              >
                                Desactivar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-s"
                                aria-label={`Activar a ${user.name}`}
                                disabled={busy}
                                onClick={() => void activate(user)}
                              >
                                Activar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </BoardCard>
            </div>
          )}

          <aside aria-label="Roles" className={styles.roles}>
            <section className={`card ${styles.roleCard}`}>
              <h2 className={styles.roleTitle}>Qué puede hacer cada rol</h2>
              <div className={styles.role}>
                <Badge tone="success">Administrador</Badge>
                <p className={styles.roleText}>
                  Todo lo del asistente, más periodos, horarios, estudiantes,
                  reportes, auditoría y usuarios.
                </p>
              </div>
              <div className={styles.role}>
                <Badge>Asistente</Badge>
                <p className={styles.roleText}>
                  Operación diaria: quién está dentro, registros manuales,
                  enrolar huellas, alarma y mensajes.
                </p>
              </div>
            </section>
            <section className={`card ${styles.sessionCard}`}>
              <span aria-hidden="true" className={styles.sessionIcon}>
                <Icon name="ahora" size={20} />
              </span>
              <div>
                <h2 className={styles.sessionTitle}>Sesión del panel</h2>
                <p className={styles.roleText}>
                  Se cierra tras un tiempo sin actividad o al alcanzar la
                  duración máxima de la sesión.
                </p>
              </div>
            </section>
          </aside>
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'reset'
            ? 'Restablecer contraseña'
            : 'Desactivar usuario'
        }
        tone={pending?.kind === 'deactivate' ? 'danger' : 'primary'}
        confirmLabel={pending?.kind === 'reset' ? 'Restablecer' : 'Desactivar'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          const { user } = pending;
          if (pending.kind === 'reset') {
            void act(async () => {
              const result = await call(
                getApi().client.POST('/users/{id}/reset-password', {
                  params: { path: { id: user.id } },
                }),
              );
              setTemporary({
                username: result.username,
                password: result.temporaryPassword,
              });
            });
          } else {
            void act(async () => {
              await call(
                getApi().client.PATCH('/users/{id}', {
                  params: { path: { id: user.id } },
                  body: { active: false },
                }),
              );
            });
          }
        }}
      >
        {pending?.kind === 'reset' ? (
          <p>
            Se cierran las sesiones de {pending.user.name} y se genera una
            contraseña temporal nueva.
          </p>
        ) : (
          <p>
            {pending?.user.name} no podrá entrar al panel y su sesión se cierra
            de inmediato.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={temporary !== null}
        title="Contraseña temporal"
        confirmLabel="Ya la anoté"
        cancelLabel="Cerrar"
        onConfirm={() => setTemporary(null)}
        onCancel={() => setTemporary(null)}
      >
        {temporary && (
          <div className="stack">
            <p>
              Entregue esta contraseña a <strong>{temporary.username}</strong>.
              Se muestra una sola vez y deberá cambiarla al entrar.
            </p>
            <p className={styles.password} data-testid="temporary-password">
              {temporary.password}
            </p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
