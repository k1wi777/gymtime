'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { useAuth } from '@/auth/auth-provider';
import { BRAND } from '@/lib/brand';
import { landingFor } from '@/lib/nav';
import { validateLogin, safeNext } from '@/lib/validators';
import { SubmitButton, TextField, useForm } from '@/ui/Form';
import { Icon } from '@/ui/icons';
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
  const [showPassword, setShowPassword] = useState(false);
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
            : safeNext(params.get('next'), landingFor(account.role)),
        );
      } catch (error) {
        form.clearField('password', '');
        setFailure(describeError(error));
      }
    },
  });

  return (
    <main className={styles.page}>
      <img
        src={BRAND.colorStrip}
        alt=""
        aria-hidden="true"
        className={styles.strip}
      />
      <div className={styles.split}>
        <section className={styles.hero}>
          <img
            src={BRAND.campus}
            alt=""
            aria-hidden="true"
            className={styles.campus}
          />
          <div aria-hidden="true" className={styles.veil} />
          <img
            src={BRAND.crestWatermark}
            alt=""
            aria-hidden="true"
            className={styles.crest}
          />
          <div className={styles.logoBox}>
            <img
              src={BRAND.logo}
              alt="Universidad de Córdoba, Montería, Colombia"
              className={styles.logo}
            />
          </div>
          <div className={styles.intro}>
            <div className={styles.accentBar} />
            <h1 className={styles.heroTitle}>GymTime UniCórdoba</h1>
            <p className={styles.heroText}>
              Control de acceso y de tiempo de permanencia del gimnasio
              institucional, con huella digital. Un panel claro para atender el
              día a día.
            </p>
          </div>
          <div className={styles.law}>
            <Icon name="candado" size={16} />
            Los datos biométricos se protegen conforme a la Ley 1581.
          </div>
        </section>
        <section className={styles.formSide}>
          <form className={styles.form} onSubmit={form.submit} noValidate>
            <div>
              <h2 className={styles.formTitle}>Iniciar sesión</h2>
              <p className={styles.formLead}>
                Ingrese con la cuenta que le asignó el administrador.
              </p>
            </div>
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
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.values.password}
              onChange={(v) => form.setValue('password', v)}
              onBlur={() => form.blur('password')}
              error={form.errors.password}
              trailing={
                <button
                  type="button"
                  className={styles.eye}
                  aria-label={
                    showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                  }
                  onClick={() => setShowPassword((shown) => !shown)}
                >
                  <Icon name="ojo" size={20} />
                </button>
              }
            />
            <SubmitButton busy={form.submitting}>Entrar</SubmitButton>
            <p className={styles.help}>
              ¿No puede ingresar o olvidó su contraseña? Solicite el
              restablecimiento al administrador del sistema.
            </p>
          </form>
        </section>
      </div>
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
