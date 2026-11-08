import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/auth/auth-provider';
import { Dispositivo } from '@/features/dispositivo/Dispositivo';
import { PorRevisar, correctedInstant } from '@/features/offline/PorRevisar';
import { RequireAuth } from '@/features/shell/RequireAuth';
import { Shell } from '@/features/shell/Shell';
import { LiveProvider } from '@/live/live-provider';
import { account, alarmOff, installFakeApi, json, liveSource } from './helpers';

const item = (over: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  deviceId: 'esp32-01',
  type: 'entry',
  slot: 4,
  ts: '2026-11-02T15:12:00.000Z', // 10:12 Bogota
  receivedAt: '2026-11-02T16:02:00.000Z',
  outcome: 'por_revisar',
  reviewReason: 'DUPLICATE_ENTRY',
  student: { id: 's1', name: 'Luis Mora', document: '222' },
  schedule: { id: 'h1', name: 'Grupo A', startsAt: '2026-11-02T15:00:00.000Z' },
  actions: ['corregir', 'descartar'],
  resolution: null,
  resolvedAt: null,
  resolutionNote: null,
  correctedTs: null,
  sessionId: null,
  ...over,
});

const page = (items: unknown[]) => ({ items, total: items.length });

function app(children: ReactNode) {
  return render(
    <AuthProvider>
      <LiveProvider>{children}</LiveProvider>
    </AuthProvider>,
  );
}

describe('Por revisar (R15, R16)', () => {
  it('lists the pending events with the reason in Spanish', async () => {
    installFakeApi({
      'GET /auth/me': account(),
      'GET /offline/review': page([item()]),
    });
    app(<PorRevisar />);
    expect(await screen.findByText('Luis Mora')).toBeTruthy();
    expect(screen.getByText('El estudiante ya estaba dentro')).toBeTruthy();
    expect(screen.queryByText('DUPLICATE_ENTRY')).toBeNull();
  });

  it('says so when nothing is pending', async () => {
    installFakeApi({
      'GET /auth/me': account(),
      'GET /offline/review': page([]),
    });
    app(<PorRevisar />);
    expect(
      await screen.findByText('No hay registros por revisar.'),
    ).toBeTruthy();
  });

  it('shows the approved and discarded events read-only in tabs', async () => {
    const user = userEvent.setup();
    const views: string[] = [];
    installFakeApi({
      'GET /auth/me': account(),
      'GET /offline/review': (request: Request) => {
        const view = new URL(request.url).searchParams.get('view') ?? '';
        views.push(view);
        return json(
          view === 'pending'
            ? page([item()])
            : page([
                item({
                  outcome: 'descartado',
                  student: { id: 's2', name: 'Ana Ruiz', document: '333' },
                }),
              ]),
        );
      },
    });
    app(<PorRevisar />);
    expect(await screen.findByText('Luis Mora')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    await user.click(screen.getByRole('tab', { name: /Descartados/ }));
    expect(await screen.findByText(/Ana Ruiz/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Resolver/ })).toBeNull();
    expect(views).toContain('discarded');
    expect(views).toContain('resolved');
  });

  it('requires a reason and sends the chosen action', async () => {
    const user = userEvent.setup();
    const resolve = vi.fn(() => json(item({ outcome: 'descartado' })));
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /offline/review': page([item()]),
      'POST /offline/review/33333333-3333-4333-8333-333333333333/resolve':
        resolve,
    });
    app(<PorRevisar />);
    await user.click(await screen.findByRole('button', { name: /Resolver/ }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Resolver' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(
      within(dialog).getByLabelText('Acción'),
      'descartar',
    );
    await user.type(
      within(dialog).getByLabelText('Motivo de la decisión'),
      'Ya estaba dentro',
    );
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);

    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    const body = await fake
      .calls(
        'POST /offline/review/33333333-3333-4333-8333-333333333333/resolve',
      )[0]!
      .json();
    expect(body).toEqual({ action: 'descartar', reason: 'Ya estaba dentro' });
    expect(await screen.findByText(/Descartar: registrado/)).toBeTruthy();
  });

  it('asks for the hour to correct and sends it as a Bogota instant', async () => {
    const user = userEvent.setup();
    const route =
      'POST /offline/review/33333333-3333-4333-8333-333333333333/resolve';
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /offline/review': page([item()]),
      [route]: json(item({ outcome: 'corregido' })),
    });
    app(<PorRevisar />);
    await user.click(await screen.findByRole('button', { name: /Resolver/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Hora correcta')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Hora correcta'), '10:15');
    await user.type(
      within(dialog).getByLabelText('Motivo de la decisión'),
      'La hora estaba mal',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Resolver' }));
    await waitFor(() => expect(fake.calls(route)).toHaveLength(1));
    expect(await fake.calls(route)[0]!.json()).toEqual({
      action: 'corregir',
      reason: 'La hora estaba mal',
      ts: '2026-11-02T10:15:00-05:00',
    });
  });

  it('shows the server explanation when the action is not possible', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'GET /auth/me': account(),
      'GET /offline/review': page([item()]),
      'POST /offline/review/33333333-3333-4333-8333-333333333333/resolve': () =>
        json(
          {
            statusCode: 409,
            code: 'ALREADY_RESOLVED',
            message: 'Otra persona ya resolvió este evento',
          },
          409,
        ),
    });
    app(<PorRevisar />);
    await user.click(await screen.findByRole('button', { name: /Resolver/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Motivo de la decisión'),
      'x',
    );
    await user.type(within(dialog).getByLabelText('Hora correcta'), '10:15');
    await user.click(within(dialog).getByRole('button', { name: 'Resolver' }));
    expect(
      await within(dialog).findByText('Otra persona ya resolvió este evento'),
    ).toBeTruthy();
  });

  it('reloads when the live stream reports a change', async () => {
    let calls = 0;
    installFakeApi({
      'GET /auth/me': account(),
      'GET /offline/review': () => {
        calls += 1;
        return json(page(calls > 1 ? [] : [item()]));
      },
    });
    app(<PorRevisar />);
    await screen.findByText('Luis Mora');
    const source = await liveSource();
    act(() => source.open());
    act(() => source.emit('offline.review', { pending: 0 }));
    expect(
      await screen.findByText('No hay registros por revisar.'),
    ).toBeTruthy();
  });

  it('builds the corrected instant on the day of the event', () => {
    expect(correctedInstant(item() as never, '23:05')).toBe(
      '2026-11-02T23:05:00-05:00',
    );
  });
});

describe('navigation counter (R16)', () => {
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

  it('shows the count and follows the live event', async () => {
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /alarm/status': alarmOff,
      'GET /devices/status': [],
      'GET /offline/review/count': { pending: 2 },
    });
    panel();
    const link = await screen.findByRole('link', { name: /Por revisar/ });
    expect(await within(link).findByLabelText('2 por revisar')).toBeTruthy();
    const source = await liveSource();
    act(() => source.open());
    // Opening the stream reloads the snapshot; the event comes after it.
    await waitFor(() =>
      expect(fake.calls('GET /offline/review/count').length).toBeGreaterThan(1),
    );
    await within(link).findByLabelText('2 por revisar');
    act(() => source.emit('offline.review', { pending: 5 }));
    expect(await within(link).findByLabelText('5 por revisar')).toBeTruthy();
    act(() => source.emit('offline.review', { pending: 0 }));
    await waitFor(() =>
      expect(within(link).queryByLabelText(/por revisar/)).toBeNull(),
    );
  });
});

describe('clock warning on the device screen (R3, R16)', () => {
  const device = {
    deviceId: 'esp32-01',
    online: true,
    lastConnectedAt: '2026-11-02T15:00:00.000Z',
    firmwareVersion: '1.2.3',
    pendingCommands: 0,
  };
  const clock = (over: Record<string, unknown> = {}) => ({
    deviceId: 'esp32-01',
    capabilities: ['offline'],
    clockOffsetSec: 45,
    clockCheckedAt: '2026-11-02T15:00:00.000Z',
    clockWarning: true,
    clockThresholdSec: 30,
    ...over,
  });

  it('warns when the offset is above the threshold', async () => {
    installFakeApi({
      'GET /auth/me': account(),
      'GET /devices/status': [device],
      'GET /offline/clock': [clock()],
    });
    app(<Dispositivo />);
    expect(await screen.findByText('Reloj del lector desfasado')).toBeTruthy();
    expect(screen.getByText('45 s')).toBeTruthy();
    expect(screen.getByText('Disponible')).toBeTruthy();
  });

  it('does not warn with a small offset', async () => {
    installFakeApi({
      'GET /auth/me': account(),
      'GET /devices/status': [device],
      'GET /offline/clock': [clock({ clockOffsetSec: 3, clockWarning: false })],
    });
    app(<Dispositivo />);
    expect(await screen.findByText('3 s')).toBeTruthy();
    expect(screen.queryByText('Reloj del lector desfasado')).toBeNull();
  });
});
