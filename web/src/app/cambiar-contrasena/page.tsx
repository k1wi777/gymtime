'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { useAuth } from '@/auth/auth-provider';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  validatePasswordChange,
} from '@/lib/validators';
import { SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import styles from '../auth.module.css';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { account, status, setAccount, signOut } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm({
    initial: { currentPassword: '', newPassword: '', confirmPassword: '' },
    validate: validatePasswordChange,
    onSubmit: async (values) => {
      setFailure(null);
      try {
        const updated = await call(
          getApi().client.POST('/auth/password', {
            body: {
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            },
          }),
        );
        setAccount(updated);
        router.replace('/ahora');
      } catch (error) {
        setFailure(describeError(error));
      }
    },
  });

  if (status === 'loading' || !account) {
    return (
      <main className={styles.wrap}>
        <Spinner />
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <form
        className={`card stack ${styles.card}`}
        onSubmit={form.submit}
        noValidate
      >
        <h1>Cambiar contraseña</h1>
        {account.mustChangePassword && (
          <Notice kind="warning">
            Es su primer ingreso o un administrador restableció su contraseña:
            debe elegir una nueva para continuar.
          </Notice>
        )}
        {failure && <Notice kind="error">{failure}</Notice>}
        <TextField
          label="Contraseña actual"
          type="password"
          autoComplete="current-password"
          value={form.values.currentPassword}
          onChange={(v) => form.setValue('currentPassword', v)}
          onBlur={() => form.blur('currentPassword')}
          error={form.errors.currentPassword}
        />
        <TextField
          label="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          help={`Entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`}
          value={form.values.newPassword}
          onChange={(v) => form.setValue('newPassword', v)}
          onBlur={() => form.blur('newPassword')}
          error={form.errors.newPassword}
        />
        <TextField
          label="Repita la nueva contraseña"
          type="password"
          autoComplete="new-password"
          value={form.values.confirmPassword}
          onChange={(v) => form.setValue('confirmPassword', v)}
          onBlur={() => form.blur('confirmPassword')}
          error={form.errors.confirmPassword}
        />
        <div className="row">
          <SubmitButton busy={form.submitting}>Guardar contraseña</SubmitButton>
          <button type="button" className="btn" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
        </div>
      </form>
    </main>
  );
}
