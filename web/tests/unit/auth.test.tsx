import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangePasswordPage from '@/app/cambiar-contrasena/page';
import LoginPage from '@/app/login/page';
import { AuthProvider } from '@/auth/auth-provider';
import { RequireRole } from '@/auth/RequireRole';
import { visibleItems, type NavItem } from '@/lib/nav';
import { account, installFakeApi, json } from './helpers';
import { nav } from './navigation-mock';

const wrap = (ui: React.ReactNode) => render(<AuthProvider>{ui}</AuthProvider>);

describe('login (R9)', () => {
  beforeEach(() => {
    nav.pathname = '/login';
  });

  it('validates before sending and never reveals which field was wrong', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi();
    wrap(<LoginPage />);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByText('Escriba el usuario.')).toBeTruthy();
    expect(screen.getByText('Escriba la contraseña.')).toBeTruthy();
    expect(fake.requests).toHaveLength(0);
  });

  it('signs in, sends the CSRF header and goes to the requested page', async () => {
    const user = userEvent.setup();
    nav.search = 'next=%2Fhorarios';
    const fake = installFakeApi({ 'POST /auth/login': account() });
    wrap(<LoginPage />);
    await user.type(screen.getByLabelText('Usuario'), ' ana ');
    await user.type(screen.getByLabelText('Contraseña'), 'una-clave-larga');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/horarios'));
    const [request] = fake.calls('POST /auth/login');
    expect(request?.headers.get('x-gymtime-client')).toBe('panel');
    expect(await request?.json()).toEqual({
      username: 'ana',
      password: 'una-clave-larga',
    });
  });

  it('ignores an external redirect target', async () => {
    const user = userEvent.setup();
    nav.search = 'next=https%3A%2F%2Fevil.com';
    installFakeApi({ 'POST /auth/login': account() });
    wrap(<LoginPage />);
    await user.type(screen.getByLabelText('Usuario'), 'ana');
    await user.type(screen.getByLabelText('Contraseña'), 'una-clave-larga');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/ahora'));
  });

  it('goes to the password change when it is forced', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'POST /auth/login': account({ mustChangePassword: true }),
    });
    wrap(<LoginPage />);
    await user.type(screen.getByLabelText('Usuario'), 'ana');
    await user.type(screen.getByLabelText('Contraseña'), 'temporal-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/cambiar-contrasena'),
    );
  });

  it('shows one generic message for bad credentials and clears the password', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'POST /auth/login': () =>
        json(
          { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x' },
          401,
        ),
    });
    wrap(<LoginPage />);
    await user.type(screen.getByLabelText('Usuario'), 'nadie');
    await user.type(screen.getByLabelText('Contraseña'), 'mala-clave');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Usuario o contraseña incorrectos, o la cuenta está bloqueada.',
    );
    expect(
      (screen.getByLabelText('Contraseña') as HTMLInputElement).value,
    ).toBe('');
    // A failed login is not an expired session: no redirect.
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('shows the expired-session notice from the closed set of codes only', () => {
    installFakeApi();
    nav.search = 'aviso=expirada';
    const { unmount } = wrap(<LoginPage />);
    expect(
      screen.getByText('Su sesión expiró. Inicie sesión de nuevo.'),
    ).toBeTruthy();
    unmount();
    nav.search = 'aviso=<script>alert(1)</script>';
    wrap(<LoginPage />);
    expect(screen.queryByText(/script/)).toBeNull();
  });

  it('stores nothing in the browser (R9)', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    installFakeApi({ 'POST /auth/login': account() });
    wrap(<LoginPage />);
    await user.type(screen.getByLabelText('Usuario'), 'ana');
    await user.type(screen.getByLabelText('Contraseña'), 'una-clave-larga');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
    setItem.mockRestore();
  });
});

describe('session handling (R8)', () => {
  it('sends an expired session to the login keeping where the user was', async () => {
    nav.pathname = '/horarios';
    installFakeApi({
      'GET /auth/me': () => json({ statusCode: 401, message: 'x' }, 401),
    });
    wrap(<div>panel</div>);
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        '/login?aviso=expirada&next=%2Fhorarios',
      ),
    );
  });

  it('sends a forced password change to its page', async () => {
    installFakeApi({ 'GET /auth/me': account({ mustChangePassword: true }) });
    wrap(<div>panel</div>);
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/cambiar-contrasena'),
    );
  });
});

describe('password change (R9)', () => {
  it('validates, sends the change and goes to the panel', async () => {
    const user = userEvent.setup();
    nav.pathname = '/cambiar-contrasena';
    const fake = installFakeApi({
      'GET /auth/me': account({ mustChangePassword: true }),
      'POST /auth/password': account(),
    });
    wrap(<ChangePasswordPage />);
    expect(await screen.findByText(/debe elegir una nueva/)).toBeTruthy();

    await user.type(screen.getByLabelText('Contraseña actual'), 'temporal-123');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'corta');
    await user.type(
      screen.getByLabelText('Repita la nueva contraseña'),
      'otra',
    );
    await user.click(
      screen.getByRole('button', { name: 'Guardar contraseña' }),
    );
    expect(screen.getByText(/al menos 10/)).toBeTruthy();
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy();
    expect(fake.calls('POST /auth/password')).toHaveLength(0);

    await user.clear(screen.getByLabelText('Nueva contraseña'));
    await user.clear(screen.getByLabelText('Repita la nueva contraseña'));
    await user.type(
      screen.getByLabelText('Nueva contraseña'),
      'nueva-clave-segura',
    );
    await user.type(
      screen.getByLabelText('Repita la nueva contraseña'),
      'nueva-clave-segura',
    );
    await user.click(
      screen.getByRole('button', { name: 'Guardar contraseña' }),
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/ahora'));
    expect(await fake.calls('POST /auth/password')[0]?.json()).toEqual({
      currentPassword: 'temporal-123',
      newPassword: 'nueva-clave-segura',
    });
  });

  it('shows the server wording of a password-policy failure', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'GET /auth/me': account(),
      'POST /auth/password': () =>
        json(
          { statusCode: 400, code: 'INVALID_CURRENT_PASSWORD', message: 'x' },
          400,
        ),
    });
    wrap(<ChangePasswordPage />);
    await screen.findByText('Cambiar contraseña');
    await user.type(
      screen.getByLabelText('Contraseña actual'),
      'equivocada-123',
    );
    await user.type(
      screen.getByLabelText('Nueva contraseña'),
      'nueva-clave-segura',
    );
    await user.type(
      screen.getByLabelText('Repita la nueva contraseña'),
      'nueva-clave-segura',
    );
    await user.click(
      screen.getByRole('button', { name: 'Guardar contraseña' }),
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'La contraseña actual no es correcta.',
    );
  });
});

describe('roles (R10)', () => {
  const items: NavItem[] = [
    { href: '/ahora', label: 'Ahora', roles: ['asistente', 'admin'] },
    { href: '/usuarios', label: 'Usuarios', roles: ['admin'] },
  ];

  it('the assistant does not see administrator sections in the menu', () => {
    expect(visibleItems('asistente', items).map((i) => i.label)).toEqual([
      'Ahora',
    ]);
    expect(visibleItems('admin', items).map((i) => i.label)).toEqual([
      'Ahora',
      'Usuarios',
    ]);
    expect(visibleItems(null, items)).toEqual([]);
  });

  it('shows a permissions notice to a role that may not open the route', async () => {
    installFakeApi({ 'GET /auth/me': account({ role: 'asistente' }) });
    wrap(
      <RequireRole roles={['admin']}>
        <p>contenido de administrador</p>
      </RequireRole>,
    );
    expect(await screen.findByText('Sin permiso')).toBeTruthy();
    expect(screen.queryByText('contenido de administrador')).toBeNull();
  });

  it('lets an allowed role through', async () => {
    installFakeApi({ 'GET /auth/me': account({ role: 'admin' }) });
    wrap(
      <RequireRole roles={['admin']}>
        <p>contenido de administrador</p>
      </RequireRole>,
    );
    await waitFor(() =>
      expect(screen.getByText('contenido de administrador')).toBeTruthy(),
    );
  });
});
