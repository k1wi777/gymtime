'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { useAuth } from '@/auth/auth-provider';
import { validateLogin, safeNext } from '@/lib/validators';
import { SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import styles from '../auth.module.css';

/** Closed set of notices: the query string never carries free text. */
const NOTICES: Record<string, { kind: 'info' | 'warning'; text: string }> = {
  expirada: {
    kind: 'warning',
    text: 'Su sesión expiró. Inicie sesión de nuevo.',
  },
  cerrada: { kind: 'info', text: 'Cerró sesión correctamente.' },
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);
  const notice = NOTICES[params.get('aviso') ?? ''];

  const form = useForm({
    initial: { username: '', password: '' },
    validate: validateLogin,
    onSubmit: async (values) => {
      setFailure(null);
      try {
        const account = await call(
          getApi().client.POST('/auth/login', {
            body: {
              username: values.username.trim(),
              password: values.password,
            },
          }),
        );
        signIn(account);
        router.replace(
          account.mustChangePassword
            ? '/cambiar-contrasena'
            : safeNext(params.get('next')),
        );
      } catch (error) {
        form.clearField('password', '');
        setFailure(describeError(error));
      }
    },
  });

  return (
    <main className={styles.wrap}>
      <form
        className={`card stack ${styles.card}`}
        onSubmit={form.submit}
        noValidate
      >
        <h1>GymTime UniCórdoba</h1>
        <p className="muted">Inicie sesión para usar el panel.</p>
        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
        {failure && <Notice kind="error">{failure}</Notice>}
        <TextField
          label="Usuario"
          name="username"
          autoComplete="username"
          value={form.values.username}
          onChange={(v) => form.setValue('username', v)}
          onBlur={() => form.blur('username')}
          error={form.errors.username}
        />
        <TextField
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
          value={form.values.password}
          onChange={(v) => form.setValue('password', v)}
          onBlur={() => form.blur('password')}
          error={form.errors.password}
        />
        <SubmitButton busy={form.submitting}>Entrar</SubmitButton>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
