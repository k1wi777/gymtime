import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/auth/auth-provider';
import { RequireAuth } from '@/features/shell/RequireAuth';
import { Shell } from '@/features/shell/Shell';
import { LiveProvider } from '@/live/live-provider';
import { useResource } from '@/lib/use-resource';
import { liveSource, account, alarmOff, installFakeApi, json } from './helpers';
import { nav } from './navigation-mock';

const panel = () =>
  render(
    <AuthProvider>
      <RequireAuth>
        <LiveProvider>
          <Shell>
            <p>contenido</p>
          </Shell>
        </LiveProvider>
      </RequireAuth>
    </AuthProvider>,
  );

const base = { 'GET /alarm/status': alarmOff, 'GET /devices/status': [] };

describe('shell (R10, R11, R19)', () => {
  it('shows the menu of the assistant and nothing of the administrator', async () => {
    installFakeApi({ ...base, 'GET /auth/me': account() });
    panel();
    const menu = await screen.findByRole('navigation', { name: 'Secciones' });
    const labels = within(menu)
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(labels).toEqual([
      'Ahora',
      'Registro manual',
      'Por revisar',
      'Enrolar huella',
      'Alarma y mensajes',
      'Dispositivo',
      'Horarios',
    ]);
    expect(screen.getByText('contenido')).toBeTruthy();
    expect(screen.getByText('Asistente')).toBeTruthy();
    expect(
      within(menu)
        .getByRole('link', { name: 'Ahora' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('groups the menu, draws the fingerprint and bell icons and keeps the color strip out of the panel (R2, R7, R13)', async () => {
    installFakeApi({ ...base, 'GET /auth/me': account() });
    const { container } = panel();
    const menu = await screen.findByRole('navigation', { name: 'Secciones' });
    expect(
      within(menu)
        .getAllByText(/^(Operación|Control|Administración)$/)
        .map((t) => t.textContent),
    ).toEqual(['Operación', 'Control']);
    const icon = (name: string) =>
      within(menu).getByRole('link', { name }).querySelector('svg');
    expect(icon('Enrolar huella')?.getAttribute('aria-hidden')).toBe('true');
    expect(icon('Enrolar huella')?.querySelectorAll('path')).toHaveLength(8);
    expect(icon('Alarma y mensajes')?.querySelectorAll('path')).toHaveLength(4);
    for (const link of within(menu).getAllByRole('link')) {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    expect(container.innerHTML).not.toContain('barra-de-colores');
    expect(container.querySelector('aside img[alt=""]')).not.toBeNull();
  });

  it('shows the administrator entries under «Administración» next to the assistant ones (R13)', async () => {
    installFakeApi({
      ...base,
      'GET /auth/me': account({ role: 'admin', name: 'Jefe Admin' }),
    });
    panel();
    const menu = await screen.findByRole('navigation', { name: 'Secciones' });
    expect(
      within(menu)
        .getAllByText(/^(Operación|Control|Administración)$/)
        .map((t) => t.textContent),
    ).toEqual(['Operación', 'Control', 'Administración']);
    expect(within(menu).getAllByRole('link')).toHaveLength(15);
    expect(screen.getByText('Administrador')).toBeTruthy();
    expect(screen.getByText('JA')).toBeTruthy();
  });

  it('renders nothing of the panel until the session is confirmed', async () => {
    installFakeApi({
      ...base,
      'GET /auth/me': () => json({ statusCode: 401, message: 'x' }, 401),
    });
    panel();
    expect(screen.queryByText('contenido')).toBeNull();
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(screen.queryByText('contenido')).toBeNull();
  });

  it('shows the live link state: connecting, connected, reconnecting, disconnected', async () => {
    installFakeApi({ ...base, 'GET /auth/me': account() });
    panel();
    const state = () =>
      screen.getByText('Conexión en vivo:').parentElement?.textContent;
    await screen.findByText('contenido');
    const source = await liveSource();
    expect(state()).toContain('Conectando…');
    act(() => source.open());
    expect(state()).toContain('Conectado');
    act(() => source.hiccup());
    expect(state()).toContain('Reconectando…');
    act(() => source.open());
    expect(state()).toContain('Conectado');
  });

  it('warns visibly when the reader goes offline', async () => {
    installFakeApi({
      ...base,
      'GET /auth/me': account(),
      'GET /devices/status': [
        {
          deviceId: 'esp32-01',
          online: true,
          lastConnectedAt: null,
          firmwareVersion: '1',
          pendingCommands: 0,
        },
      ],
    });
    panel();
    await screen.findByText('contenido');
    const source = await liveSource();
    act(() => source.open());
    await waitFor(() =>
      expect(screen.queryByText('Lector fuera de línea')).toBeNull(),
    );
    act(() =>
      source.emit('device.disconnected', {
        deviceId: 'esp32-01',
        reason: 'closed',
      }),
    );
    expect(await screen.findByText('Lector fuera de línea')).toBeTruthy();
    expect(document.title).toContain('Lector fuera de línea');
  });

  it('keeps an alert while the reader stays offline past the threshold and clears it on reconnection (H11)', async () => {
    installFakeApi({
      ...base,
      'GET /auth/me': account(),
      'GET /devices/status': [
        {
          deviceId: 'esp32-01',
          online: true,
          lastConnectedAt: '2026-11-06T15:00:00.000Z',
          firmwareVersion: '1',
          pendingCommands: 0,
          tokenStatus: 'own',
          offlineSince: null,
          offlineAlert: false,
          alertThresholdMinutes: 5,
        },
      ],
    });
    panel();
    await screen.findByText('contenido');
    const source = await liveSource();
    act(() => source.open());
    act(() =>
      source.emit('device.disconnected', {
        deviceId: 'esp32-01',
        reason: 'heartbeat_timeout',
      }),
    );
    expect(await screen.findByText('Lector fuera de línea')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    act(() =>
      source.emit('device.offline_alert', {
        deviceId: 'esp32-01',
        offlineMinutes: 5,
        thresholdMinutes: 5,
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Lector sin conexión');
    expect(alert.textContent).toContain('esp32-01');
    expect(alert.textContent).toContain('5 min');

    act(() =>
      source.emit('device.connected', {
        deviceId: 'esp32-01',
        firmwareVersion: '1',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows a permissions notice when the API answers 403', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({ ...base, 'GET /auth/me': account() });
    panel();
    await screen.findByText('contenido');
    fake.route('GET /students', () =>
      json({ statusCode: 403, code: 'FORBIDDEN_ROLE', message: 'x' }, 403),
    );
    await act(async () => {
      await fake.api.client.GET('/students', {});
    });
    expect(
      await screen.findByText('Su rol no permite esta operación.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByText('Su rol no permite esta operación.')).toBeNull();
  });

  it('renews the session with real activity, at most once a minute', async () => {
    const fake = installFakeApi({ ...base, 'GET /auth/me': account() });
    panel();
    await screen.findByText('contenido');
    const before = fake.calls('GET /auth/me').length;
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.calls('GET /auth/me').length).toBe(before); // no activity, no calls
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
      window.dispatchEvent(new Event('keydown'));
    });
    await waitFor(() =>
      expect(fake.calls('GET /auth/me').length).toBe(before + 1),
    );
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.calls('GET /auth/me').length).toBe(before + 1);
  });

  it('signs out and goes to the login', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({
      ...base,
      'GET /auth/me': account(),
      'POST /auth/logout': () => new Response(null, { status: 204 }),
    });
    panel();
    await user.click(
      await screen.findByRole('button', { name: 'Cerrar sesión' }),
    );
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/login?aviso=cerrada'),
    );
    expect(
      fake.calls('POST /auth/logout')[0]?.headers.get('x-gymtime-client'),
    ).toBe('panel');
  });
});

describe('useResource', () => {
  it('keeps the previous data while reloading and ignores a stale answer', async () => {
    const answers: Array<(v: string) => void> = [];
    const load = vi.fn(
      () => new Promise<string>((resolve) => answers.push(resolve)),
    );
    const { result, rerender } = renderHook(
      ({ id }) => useResource(load, [id]),
      {
        initialProps: { id: 1 },
      },
    );
    expect(result.current.loading).toBe(true);
    await act(async () => answers[0]?.('uno'));
    expect(result.current).toMatchObject({ data: 'uno', loading: false });

    rerender({ id: 2 }); // starts a second request
    rerender({ id: 3 }); // and a third: the second must be ignored
    await act(async () => answers[2]?.('tres'));
    await act(async () => answers[1]?.('dos'));
    expect(result.current.data).toBe('tres');

    act(() => result.current.reload());
    expect(result.current.data).toBe('tres');
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('exposes the error and clears it on the next success', async () => {
    let fail = true;
    const { result } = renderHook(() =>
      useResource(async () => {
        if (fail) throw new Error('boom');
        return 'ok';
      }, []),
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    fail = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.error).toBeUndefined();
  });
});
