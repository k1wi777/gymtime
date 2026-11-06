'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError, issuesByField } from '@/api/errors';
import type { Account } from '@/api/types';
import { useAuth } from '@/auth/auth-provider';
import { formatDateTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import type { FieldErrors } from '@/lib/validators';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SelectField, SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
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
      className="card stack"
      onSubmit={form.submit}
      noValidate
      aria-label={creating ? 'Nuevo usuario' : `Editar ${user.name}`}
    >
      <h2>{creating ? 'Nuevo usuario' : `Editar ${user.name}`}</h2>
      {failure && <Notice kind="error">{failure}</Notice>}
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
      <div className="row">
        <SubmitButton busy={form.submitting}>
          {creating ? 'Crear usuario' : 'Guardar cambios'}
        </SubmitButton>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
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
    <div className="stack">
      <h1>Usuarios del panel</h1>
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      {mode === 'none' && (
        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMode('new')}
          >
            Nuevo usuario
          </button>
        </div>
      )}
      {mode === 'new' && (
        <UserForm
          user={null}
          onCancel={() => setMode('none')}
          onSaved={(password) => {
            setMode('none');
            setTemporary(password);
            users.reload();
          }}
        />
      )}
      {typeof mode === 'object' && (
        <UserForm
          key={mode.edit.id}
          user={mode.edit}
          onCancel={() => setMode('none')}
          onSaved={() => {
            setMode('none');
            users.reload();
          }}
        />
      )}
      {users.loading && !users.data && <Spinner />}
      {users.error ? (
        <Notice kind="error">{describeError(users.error)}</Notice>
      ) : null}
      {users.data && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="visually-hidden">Usuarios del panel</caption>
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
            <tbody>
              {users.data.map((user) => {
                const self = user.id === account?.id;
                return (
                  <tr key={user.id}>
                    <td>
                      {user.name} {self && <Badge tone="info">Usted</Badge>}
                    </td>
                    <td>{user.username}</td>
                    <td>{ROLE_LABELS[user.role]}</td>
                    <td>
                      <Badge tone={user.active ? 'success' : 'neutral'}>
                        {user.active ? 'Activo' : 'Inactivo'}
                      </Badge>{' '}
                      {user.mustChangePassword && (
                        <Badge tone="warning">Debe cambiar la contraseña</Badge>
                      )}
                    </td>
                    <td>
                      {user.lastLoginAt
                        ? formatDateTime(user.lastLoginAt)
                        : '—'}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Editar a ${user.name}`}
                          onClick={() => setMode({ edit: user })}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Restablecer contraseña de ${user.name}`}
                          onClick={() => setPending({ kind: 'reset', user })}
                        >
                          Restablecer contraseña
                        </button>
                        {user.active ? (
                          <button
                            type="button"
                            className="btn btn-danger"
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
                            className="btn"
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
          </table>
        </div>
      )}

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
