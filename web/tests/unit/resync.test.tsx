import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '@/auth/auth-provider';
import { Dispositivo } from '@/features/dispositivo/Dispositivo';
import { NOTICE_DURATIONS } from '@/ui/Notice';
import { LiveProvider } from '@/live/live-provider';
import { account, installFakeApi, json } from './helpers';

const device = {
  deviceId: 'esp32-01',
  online: true,
  lastConnectedAt: '2026-11-02T15:00:00.000Z',
  firmwareVersion: '1.2.3',
  pendingCommands: 0,
};

const syncResult = (over: Record<string, unknown> = {}) => ({
  syncId: '44444444-4444-4444-8444-444444444444',
  deviceId: 'esp32-01',
  scheduleId: null,
  reason: 'manual',
  status: 'ok',
  templates: 12,
  chunks: 2,
  omitted: 0,
  error: null,
  ...over,
});

function app() {
  return render(
    <AuthProvider>
      <LiveProvider>
        <Dispositivo />
      </LiveProvider>
    </AuthProvider>,
  );
}

const setup = (role: 'asistente' | 'administrador', sync: unknown) =>
  installFakeApi({
    'GET /auth/me': account({ role }),
    'GET /devices/status': [device],
    'GET /offline/clock': [],
    'POST /sync': sync,
  });

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText('En línea');
  await user.click(
    screen.getByRole('button', { name: 'Resincronizar lector' }),
  );
  return screen.getByRole('dialog');
};

describe('Resincronizar lector', () => {
  it.each(['asistente', 'administrador'] as const)(
    'is visible for %s',
    async (role) => {
      setup(role, syncResult());
      app();
      await screen.findByText('En línea');
      expect(
        screen.getByRole('button', { name: 'Resincronizar lector' }),
      ).toBeTruthy();
    },
  );

  it('asks first, and cancelling does not call the API', async () => {
    const user = userEvent.setup();
    const fake = setup('asistente', syncResult());
    app();
    const dialog = await openDialog(user);
    expect(within(dialog).getByText(/Se borrará la librería/)).toBeTruthy();
    expect(fake.calls('POST /sync')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(fake.calls('POST /sync')).toHaveLength(0);
  });

  it('disables the button while running and reports success', async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => undefined;
    const fake = setup(
      'asistente',
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    app();
    const dialog = await openDialog(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'Resincronizar' }),
    );
    await waitFor(() => expect(fake.calls('POST /sync')).toHaveLength(1));
    expect(
      (
        screen.getByRole('button', {
          name: 'Resincronizando…',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => release(json(syncResult({ omitted: 2 }))));
    expect(await screen.findByText(/Se cargaron 12 huellas/)).toBeTruthy();
    expect(screen.getByText(/2 quedaron fuera/)).toBeTruthy();
  });

  it('closes the success notice by itself', async () => {
    const user = userEvent.setup();
    setup('asistente', syncResult());
    app();
    const dialog = await openDialog(user);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await user.click(
        within(dialog).getByRole('button', { name: 'Resincronizar' }),
      );
      await screen.findByText(/Se cargaron 12 huellas/);
      act(() => void vi.advanceTimersByTime(NOTICE_DURATIONS.success + 2_000));
      expect(screen.queryByText(/Se cargaron 12 huellas/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the cause of a failed sync and keeps the notice', async () => {
    const user = userEvent.setup();
    setup('asistente', syncResult({ status: 'failed', error: 'CHUNK_FAILED' }));
    app();
    const dialog = await openDialog(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'Resincronizar' }),
    );
    expect(
      await screen.findByText(/no confirmó alguno de los bloques/),
    ).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByText(/no confirmó alguno de los bloques/),
    ).toBeTruthy();
  });

  it('explains a 409 as no reader online', async () => {
    const user = userEvent.setup();
    setup('administrador', () =>
      json({ statusCode: 409, message: 'No device online' }, 409),
    );
    app();
    const dialog = await openDialog(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'Resincronizar' }),
    );
    expect(await screen.findByText('No hay un lector en línea.')).toBeTruthy();
  });
});
