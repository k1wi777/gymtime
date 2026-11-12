import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/auth/auth-provider';
import { AlarmBanner } from '@/features/alarma/AlarmBanner';
import { Ahora } from '@/features/ahora/Ahora';
import { Dispositivo } from '@/features/dispositivo/Dispositivo';
import { Enrolar } from '@/features/enrolar/Enrolar';
import { Horarios } from '@/features/horarios/Horarios';
import { Ordenes } from '@/features/ordenes/Ordenes';
import { Registro } from '@/features/registro/Registro';
import { LiveProvider } from '@/live/live-provider';
import { nav } from './navigation-mock';
import {
  liveSource,
  account,
  alarmOff,
  installFakeApi,
  json,
  person,
  pinToday,
} from './helpers';

const NOW = '2026-11-02T15:20:00.000Z'; // 10:20 in Bogota
const ENDS = '2026-11-02T16:00:00.000Z';

const current = {
  scheduleId: 's1',
  scheduleName: 'Grupo A',
  instanceId: 'i1',
  startsAt: '2026-11-02T15:00:00.000Z',
  endsAt: ENDS,
  entryClosesAt: '2026-11-02T15:55:00.000Z',
  entryOpen: true,
  remainingSeconds: 2400,
};

const ana = person({ studentId: 'a', name: 'Ana Gómez', document: '1' });
const beto = person({
  studentId: 'b',
  name: 'Beto Ruiz',
  document: '2',
  hasFingerprint: false,
});

const snapshot = (over: Record<string, unknown> = {}) => ({
  serverNow: NOW,
  current,
  counts: { expected: 2, inside: 0, exited: 0, missing: 2 },
  inside: [],
  exited: [],
  missing: [ana, beto],
  alarm: alarmOff,
  ...over,
});

const inside = {
  ...ana,
  enteredAt: '2026-11-02T15:21:00.000Z',
  source: 'device',
  sessionStatus: 'abierta',
};

function app(children: ReactNode) {
  return render(
    <AuthProvider>
      <LiveProvider>{children}</LiveProvider>
    </AuthProvider>,
  );
}

const open = async () => {
  const source = await liveSource();
  act(() => source.open());
};
const emit = async (type: string, data: unknown) => {
  const source = await liveSource();
  act(() => source.emit(type, data));
};

describe('«Ahora» (R15)', () => {
  it('moves a person from «Faltan» to «Dentro» when the scan arrives, without reloading', async () => {
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /panel/now': snapshot(),
    });
    app(<Ahora />);
    const faltan = await screen.findByRole('region', { name: 'Faltan' });
    expect(within(faltan).getByText('Ana Gómez')).toBeTruthy();
    expect(within(faltan).getByText('Sin huella')).toBeTruthy();
    await open();

    fake.route(
      'GET /panel/now',
      snapshot({
        counts: { expected: 2, inside: 1, exited: 0, missing: 1 },
        inside: [inside],
        missing: [beto],
      }),
    );
    await emit('attendance', {
      change: 'entry',
      source: 'device',
      studentId: 'a',
      studentName: 'Ana Gómez',
      instanceId: 'i1',
      sessionId: 'x',
    });

    const dentro = await screen.findByRole('region', { name: 'Dentro' });
    await waitFor(() =>
      expect(within(dentro).getByText('Ana Gómez')).toBeTruthy(),
    );
    expect(
      within(screen.getByRole('region', { name: 'Faltan' })).queryByText(
        'Ana Gómez',
      ),
    ).toBeNull();
    // Only the snapshot was refetched; the page was not reloaded.
    expect(fake.calls('GET /panel/now').length).toBeGreaterThanOrEqual(2);
  });

  it('groups a burst of events into a single refetch', async () => {
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /panel/now': snapshot(),
    });
    app(<Ahora />);
    await screen.findByText('Grupo A');
    await open();
    await waitFor(() =>
      expect(fake.calls('GET /panel/now').length).toBeGreaterThanOrEqual(2),
    ); // resync
    const before = fake.calls('GET /panel/now').length;
    const source = await liveSource();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (let i = 0; i < 5; i++) act(() => source.emit('attendance', {}));
    expect(fake.calls('GET /panel/now').length).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(fake.calls('GET /panel/now').length).toBe(before + 1),
    );
  });

  it('counts the remaining time down every second', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(NOW));
    installFakeApi({ 'GET /auth/me': account(), 'GET /panel/now': snapshot() });
    app(<Ahora />);
    await vi.waitFor(() =>
      expect(screen.getByTestId('countdown').textContent).toBe('40:00'),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId('countdown').textContent).toBe('39:59');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(screen.getByTestId('countdown').textContent).toBe('39:00');
  });

  it('measures the countdown against the server clock, not the browser clock', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z')); // a wrong browser clock
    installFakeApi({ 'GET /auth/me': account(), 'GET /panel/now': snapshot() });
    app(<Ahora />);
    await vi.waitFor(() =>
      expect(screen.getByTestId('countdown').textContent).toBe('40:00'),
    );
  });

  it('shows times in Bogota and says when no schedule is running', async () => {
    installFakeApi({
      'GET /auth/me': account(),
      'GET /panel/now': snapshot({
        current: null,
        counts: { expected: 0, inside: 0, exited: 0, missing: 0 },
        missing: [],
      }),
    });
    app(<Ahora />);
    expect(await screen.findByText('No hay un horario en curso.')).toBeTruthy();
    expect(screen.queryByTestId('countdown')).toBeNull();
  });

  it('lists the last scans with the rejection reason in Spanish', async () => {
    installFakeApi({ 'GET /auth/me': account(), 'GET /panel/now': snapshot() });
    app(<Ahora />);
    await screen.findByText('Grupo A');
    await open();
    await emit('scan', {
      deviceId: 'd',
      slot: 4,
      result: 'denied',
      studentId: 'a',
      studentName: 'Ana Gómez',
      reason: 'OUTSIDE_ENTRY_WINDOW',
    });
    const feed = screen.getByRole('region', { name: 'Últimos escaneos' });
    expect(within(feed).getByText('Rechazado')).toBeTruthy();
    expect(
      within(feed).getByText('El ingreso está fuera de la ventana permitida.'),
    ).toBeTruthy();
  });

  it('keeps the last state and offers a retry when a reload fails', async () => {
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /panel/now': snapshot(),
    });
    app(<Ahora />);
    await screen.findByText('Grupo A');
    await open();
    fake.route('GET /panel/now', () =>
      json({ statusCode: 500, message: 'x' }, 500),
    );
    (await liveSource()).hiccup();
    (await liveSource()).open();
    expect(
      await screen.findByText(/Se muestra el último estado conocido/),
    ).toBeTruthy();
    expect(screen.getByText('Grupo A')).toBeTruthy();
  });
});

describe('alarm banner (R20)', () => {
  const sounding = {
    ...alarmOff,
    on: true,
    reason: 'PENDING_EXIT',
    openSessions: 2,
    instanceId: 'i1',
    startedAt: NOW,
  };

  it('appears while the alarm sounds, asks for confirmation and reports the closed sessions', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /alarm/status': sounding,
      'POST /alarm/off': {
        closedBy: 'cli',
        sessionsClosed: 2,
        status: alarmOff,
      },
    });
    app(<AlarmBanner />);
    const banner = await screen.findByText('ALARMA SONANDO');
    expect(banner).toBeTruthy();
    expect(screen.getByText(/2 personas siguen dentro/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Apagar alarma' }));
    expect(fake.calls('POST /alarm/off')).toHaveLength(0);
    expect(screen.getByText(/se cerrarán como «no registrada»/)).toBeTruthy();

    fake.route('GET /alarm/status', alarmOff);
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Apagar alarma' }),
    );

    expect(
      await screen.findByText(
        /2 sesiones quedaron cerradas como no registradas/,
      ),
    ).toBeTruthy();
    expect(
      fake.calls('POST /alarm/off')[0]?.headers.get('x-gymtime-client'),
    ).toBe('panel');
    await waitFor(() =>
      expect(screen.queryByText('ALARMA SONANDO')).toBeNull(),
    );
  });

  it('follows the alarm events and reports a silence done elsewhere', async () => {
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /alarm/status': alarmOff,
    });
    app(<AlarmBanner />);
    await open();
    await waitFor(() =>
      expect(fake.calls('GET /alarm/status').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('ALARMA SONANDO')).toBeNull();

    fake.route('GET /alarm/status', sounding);
    await emit('alarm', {
      on: true,
      reason: 'PENDING_EXIT',
      closedBy: null,
      sessionsClosed: 0,
    });
    expect(await screen.findByText('ALARMA SONANDO')).toBeTruthy();

    fake.route('GET /alarm/status', alarmOff);
    await emit('alarm', {
      on: false,
      reason: 'CLEARED',
      closedBy: 'button',
      sessionsClosed: 1,
    });
    await waitFor(() =>
      expect(screen.queryByText('ALARMA SONANDO')).toBeNull(),
    );
    expect(
      screen.getByText(/1 sesión quedó cerrada como no registradas/),
    ).toBeTruthy();
  });
});

describe('manual registration (R16)', () => {
  const students = [
    {
      id: 'a',
      name: 'Ana Gómez',
      document: '1',
      active: true,
      consented: true,
      displayName: 'ANA',
      email: null,
      phone: null,
      program: null,
    },
    {
      id: 'b',
      name: 'Beto Ruiz',
      document: '2',
      active: true,
      consented: true,
      displayName: 'BETO',
      email: null,
      phone: null,
      program: null,
    },
  ];
  const session = {
    id: 'ses',
    student: { id: 'a', document: '1', name: 'Ana Gómez' },
    enteredAt: '2026-11-02T15:25:00.000Z',
    exitedAt: null,
    instance: {
      id: 'i1',
      scheduleId: 's1',
      startsAt: current.startsAt,
      endsAt: ENDS,
    },
    entrySource: 'manual',
    exitSource: null,
    status: 'abierta',
    manualReason: 'x',
  };

  it('requires a reason, confirms, and shows the result', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /students': students,
      'POST /attendance/entry': () => json(session, 201),
    });
    app(<Registro />);
    const submit = await screen.findByRole('button', {
      name: 'Registrar entrada',
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Elija primero un estudiante.')).toBeTruthy();

    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.getByText(/Nadie coincide con «zzz»/)).toBeTruthy();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'beto');
    expect(screen.queryByRole('option', { name: /Ana/ })).toBeNull();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'gomez');
    await user.click(screen.getByRole('option', { name: /Ana Gómez/ }));
    const card = screen.getByRole('status');
    expect(within(card).getByText('Estudiante seleccionado')).toBeTruthy();
    expect(within(card).getByText('Ana Gómez')).toBeTruthy();
    const named = screen.getByRole('button', {
      name: 'Registrar entrada de Ana',
    });
    expect((named as HTMLButtonElement).disabled).toBe(false);
    // «Cambiar» goes back to the search and disables the button again.
    await user.click(within(card).getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Registrar entrada',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.type(screen.getByRole('combobox'), '1');
    await user.click(screen.getByRole('option', { name: /Ana Gómez/ }));
    await user.type(screen.getByLabelText(/Motivo/), '   ');
    await user.click(
      screen.getByRole('button', { name: 'Registrar entrada de Ana' }),
    );
    expect(screen.getByText('El motivo es obligatorio.')).toBeTruthy();
    await user.type(
      screen.getByLabelText(/Motivo/),
      ' el lector no la reconoce ',
    );
    await user.click(
      screen.getByRole('button', { name: 'Registrar entrada de Ana' }),
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/el lector no la reconoce/)).toBeTruthy();
    expect(fake.calls('POST /attendance/entry')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));

    expect(
      await screen.findByText('Entrada registrada para Ana Gómez a las 10:25.'),
    ).toBeTruthy();
    const [request] = fake.calls('POST /attendance/entry');
    expect(await request?.json()).toEqual({
      studentId: 'a',
      reason: 'el lector no la reconoce',
    });
  });

  it('explains in Spanish why the server refused', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'GET /auth/me': account(),
      'GET /students': students,
      'POST /attendance/exit': () =>
        json(
          {
            statusCode: 409,
            code: 'NO_OPEN_SESSION',
            message: 'The student has no open session',
          },
          409,
        ),
    });
    app(<Registro />);
    await user.click(await screen.findByRole('radio', { name: 'Salida' }));
    await user.type(screen.getByRole('combobox'), 'ana');
    await user.keyboard('{ArrowDown}{Enter}');
    await user.type(screen.getByLabelText(/Motivo/), 'se fue sin marcar');
    await user.click(
      screen.getByRole('button', { name: 'Registrar salida de Ana' }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Registrar',
      }),
    );
    const alert = await screen.findByText(
      'El estudiante no tiene una entrada abierta.',
    );
    expect(alert).toBeTruthy();
    expect(screen.queryByText(/open session/)).toBeNull();
  });
});

describe('enrollment (R17)', () => {
  const withConsent = {
    id: 'a',
    name: 'Ana Gómez',
    document: '1',
    active: true,
    consented: true,
    displayName: 'ANA',
    email: null,
    phone: null,
    program: null,
  };
  const noConsent = {
    ...withConsent,
    id: 'b',
    name: 'Beto Ruiz',
    document: '2',
    consented: false,
  };
  const enrollment = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    studentId: 'a',
    deviceId: 'esp32',
    status: 'in_progress',
    step: null,
    failureReason: null,
    expiresAt: '2026-11-02T15:30:00.000Z',
    ...over,
  });

  const setup = () =>
    installFakeApi({
      'GET /auth/me': account(),
      'GET /students': [withConsent, noConsent],
      'GET /panel/fingerprints': { studentIds: [] },
      'POST /students/a/enrollments': () => json(enrollment(), 201),
      'POST /enrollments/e1/cancel': () =>
        json(enrollment({ status: 'cancelled' })),
    });

  const choose = async (
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ) => {
    await screen.findByText(name);
    await user.click(screen.getByRole('button', { name: `Elegir a ${name}` }));
  };

  it('shows each step the reader reports and the final result', async () => {
    const user = userEvent.setup();
    setup();
    app(<Enrolar />);
    await choose(user, 'Ana Gómez');
    await open();
    await user.click(
      screen.getByRole('button', { name: 'Iniciar enrolamiento' }),
    );
    expect(await screen.findByText('Esperando al lector…')).toBeTruthy();

    for (const [step, text] of [
      ['place_finger', 'Ponga el dedo en el lector'],
      ['remove_finger', 'Retire el dedo'],
      ['place_again', 'Vuelva a poner el mismo dedo'],
      ['processing', 'Procesando la huella'],
    ] as const) {
      await emit('enrollment', {
        enrollmentId: 'e1',
        studentId: 'a',
        deviceId: 'esp32',
        status: 'in_progress',
        step,
        failureReason: null,
      });
      expect(screen.getByTestId('enroll-step').textContent).toBe(text);
    }
    // Events of another enrollment are ignored.
    await emit('enrollment', {
      enrollmentId: 'other',
      studentId: 'x',
      deviceId: 'esp32',
      status: 'failed',
      step: null,
      failureReason: 'x',
    });
    expect(screen.getByTestId('enroll-step').textContent).toBe(
      'Procesando la huella',
    );

    await emit('enrollment', {
      enrollmentId: 'e1',
      studentId: 'a',
      deviceId: 'esp32',
      status: 'done',
      step: 'processing',
      failureReason: null,
    });
    expect(
      await screen.findByText('Huella registrada', { selector: 'strong' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Cancelar enrolamiento' }),
    ).toBeNull();
  });

  it('shows failure and expiry with their own messages', async () => {
    const user = userEvent.setup();
    setup();
    app(<Enrolar />);
    await choose(user, 'Ana Gómez');
    await open();
    await user.click(
      screen.getByRole('button', { name: 'Iniciar enrolamiento' }),
    );
    await screen.findByText('Esperando al lector…');
    await emit('enrollment', {
      enrollmentId: 'e1',
      studentId: 'a',
      deviceId: 'esp32',
      status: 'failed',
      step: null,
      failureReason: 'BAD_SIZE: template too small',
    });
    expect(await screen.findByText('El enrolamiento falló')).toBeTruthy();
    expect(screen.getByText(/BAD_SIZE/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(
      screen.getByRole('button', { name: 'Iniciar enrolamiento' }),
    ).toBeTruthy();
  });

  it('can be cancelled while it runs', async () => {
    const user = userEvent.setup();
    const fake = setup();
    app(<Enrolar />);
    await choose(user, 'Ana Gómez');
    await user.click(
      screen.getByRole('button', { name: 'Iniciar enrolamiento' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Cancelar enrolamiento' }),
    );
    expect(await screen.findByText('Enrolamiento cancelado')).toBeTruthy();
    expect(fake.calls('POST /enrollments/e1/cancel')).toHaveLength(1);
  });

  it('asks the server where the enrollment is after the stream reconnects', async () => {
    const user = userEvent.setup();
    const fake = setup();
    app(<Enrolar />);
    await choose(user, 'Ana Gómez');
    await open();
    await user.click(
      screen.getByRole('button', { name: 'Iniciar enrolamiento' }),
    );
    await screen.findByText('Esperando al lector…');
    fake.route(
      'GET /enrollments/e1',
      enrollment({ status: 'done', step: 'processing' }),
    );
    (await liveSource()).hiccup();
    await open();
    expect(
      await screen.findByText('Huella registrada', { selector: 'strong' }),
    ).toBeTruthy();
  });

  it('cannot start without consent; it is registered only after an explicit confirmation', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('GET /students/consent', {
      version: 'v9',
      text: 'Texto vigente del servidor',
    });
    fake.route('POST /students/b/consent', () =>
      json({ ...noConsent, consented: true }),
    );
    app(<Enrolar />);
    await choose(user, 'Beto Ruiz');

    const start = screen.getByRole('button', {
      name: 'Iniciar enrolamiento',
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(
      screen.getByText(/no se puede enrolar la huella sin el consentimiento/i),
    ).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'Registrar consentimiento…' }),
    );
    const dialog = screen.getByRole('dialog');
    // The text comes from the server, not from the panel.
    expect(
      await within(dialog).findByText('Texto vigente del servidor'),
    ).toBeTruthy();
    const confirm = within(dialog).getByRole('button', {
      name: 'Registrar consentimiento',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // needs the explicit acceptance
    await user.click(within(dialog).getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);

    fake.route('GET /students', [
      withConsent,
      { ...noConsent, consented: true },
    ]);
    await user.click(confirm);
    await waitFor(() =>
      expect(fake.calls('POST /students/b/consent')).toHaveLength(1),
    );
    expect(await fake.calls('POST /students/b/consent')[0]?.json()).toEqual({
      version: 'v9',
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Iniciar enrolamiento',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });

  it('marks students without a fingerprint and filters them', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('GET /panel/fingerprints', { studentIds: ['a'] });
    app(<Enrolar />);
    await screen.findByText('Beto Ruiz');
    expect(screen.getAllByText('Sin huella')).toHaveLength(2); // badge + select option
    await user.selectOptions(screen.getByLabelText('Huella'), 'without');
    expect(screen.queryByText('Ana Gómez')).toBeNull();
    expect(screen.getByText('Beto Ruiz')).toBeTruthy();
  });
});

describe('orders (R18)', () => {
  it('counts characters per line and refuses more than 16', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /alarm/status': alarmOff,
      'POST /devices/messages': () =>
        json({ commandId: 'c1', deviceId: 'd', status: 'acked' }),
    });
    app(<Ordenes />);
    const line1 = await screen.findByLabelText(/Línea 1/);
    expect(screen.getAllByText('0/16 caracteres')).toHaveLength(2);
    await user.type(line1, 'Hola equipo');
    expect(screen.getByText('11/16 caracteres')).toBeTruthy();
    await user.type(line1, ' de la tarde');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(screen.getByText(/Máximo 16 caracteres/)).toBeTruthy();
    expect(fake.calls('POST /devices/messages')).toHaveLength(0);

    await user.clear(line1);
    await user.type(line1, 'Cierre en 5 min');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(
      await screen.findByText('Mensaje mostrado en el lector.'),
    ).toBeTruthy();
    expect(await fake.calls('POST /devices/messages')[0]?.json()).toEqual({
      line1: 'Cierre en 5 min',
    });
  });

  it('shows the state of each order from the command events', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'GET /auth/me': account(),
      'GET /alarm/status': alarmOff,
      'POST /alarm/test': alarmOff,
    });
    app(<Ordenes />);
    await screen.findByText('Todavía no hay órdenes.');
    await open();
    await user.click(screen.getByRole('button', { name: 'Probar alarma' }));
    expect(
      await screen.findByText(
        'Orden de prueba enviada: sonará un pitido corto.',
      ),
    ).toBeTruthy();

    const command = {
      deviceId: 'd',
      commandId: 'c9',
      commandType: 'alarm.set',
      attempts: 1,
    };
    await emit('command', { ...command, status: 'pending' });
    const table = screen.getByRole('table', { name: 'Órdenes recientes' });
    expect(within(table).getByText('En cola')).toBeTruthy();
    await emit('command', { ...command, status: 'sent' });
    expect(within(table).getByText('Enviada')).toBeTruthy();
    await emit('command', { ...command, status: 'acked' });
    expect(within(table).getByText('Confirmada')).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await emit('command', {
      ...command,
      commandId: 'c10',
      commandType: 'display.message',
      status: 'failed',
    });
    expect(within(table).getByText('Fallida')).toBeTruthy();
    expect(within(table).getByText('Mensaje en pantalla')).toBeTruthy();
  });

  it('reports a conflict when there is no reader online', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'GET /auth/me': account(),
      'GET /alarm/status': alarmOff,
      'POST /alarm/on': () =>
        json({ statusCode: 409, code: 'NO_DEVICE_ONLINE', message: 'x' }, 409),
    });
    app(<Ordenes />);
    await user.click(
      await screen.findByRole('button', { name: 'Encender alarma' }),
    );
    expect(await screen.findByText('No hay un lector en línea.')).toBeTruthy();
  });
});

describe('device (R19)', () => {
  const device = {
    deviceId: 'esp32-01',
    online: true,
    lastConnectedAt: '2026-11-02T15:00:00.000Z',
    firmwareVersion: '1.2.3',
    pendingCommands: 2,
  };

  it('shows the state, and the clock offset only when the API reports it', async () => {
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /devices/status': [device],
    });
    const { unmount } = app(<Dispositivo />);
    expect(await screen.findByText('En línea')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(/10:00/)).toBeTruthy();
    expect(screen.queryByText('Desfase del reloj')).toBeNull();
    unmount();

    fake.route('GET /devices/status', [{ ...device, clockOffsetSeconds: 3 }]);
    app(<Dispositivo />);
    expect(await screen.findByText('Desfase del reloj')).toBeTruthy();
  });

  it('draws the four metric cards without the empty circle', async () => {
    installFakeApi({
      'GET /auth/me': account(),
      'GET /devices/status': [device],
    });
    const { container } = app(<Dispositivo />);
    await screen.findByText('En línea');
    const metrics = container.querySelector('dl');
    expect(metrics?.querySelectorAll('div')).not.toHaveLength(0);
    // Only the top stripe remains; the circle (`dot`) is gone.
    expect(metrics?.querySelectorAll('span[aria-hidden]')).toHaveLength(
      metrics?.querySelectorAll('div').length ?? -1,
    );
    expect(metrics?.querySelector('[class*="dot"]')).toBeNull();
  });

  it('goes offline on the disconnection event', async () => {
    installFakeApi({
      'GET /auth/me': account(),
      'GET /devices/status': [device],
    });
    app(<Dispositivo />);
    await screen.findByText('En línea');
    await open();
    await emit('device.disconnected', {
      deviceId: 'esp32-01',
      reason: 'heartbeat_timeout',
    });
    expect(await screen.findByText('Fuera de línea')).toBeTruthy();
  });

  it('explains the empty state', async () => {
    installFakeApi({ 'GET /auth/me': account(), 'GET /devices/status': [] });
    app(<Dispositivo />);
    expect(
      await screen.findByText(/Todavía no se ha conectado ningún lector/),
    ).toBeTruthy();
  });
});

describe('schedule rosters (R21)', () => {
  beforeEach(() => pinToday());

  /** Opens the schedule picker, then the Monday and its schedule. */
  const pickSchedule = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByLabelText('Horario'));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('option', { name: /^lunes/ }));
    await user.click(dialog.getByRole('option', { name: /Grupo A/ }));
  };

  const schedules = [
    {
      id: 's1',
      name: 'Grupo A',
      weekday: 1,
      date: null,
      startTime: '10:00:00',
      endTime: '11:00:00',
      entryOpenMinutes: null,
      entryCloseMinutes: null,
      students: [],
      upcoming: [],
    },
  ];
  const roster = (over: Record<string, unknown> = {}) => ({
    scheduleId: 's1',
    scheduleName: 'Grupo A',
    date: '2026-11-02',
    occurrence: {
      instanceId: 'i1',
      date: '2026-11-02',
      startsAt: current.startsAt,
      endsAt: ENDS,
    },
    phase: 'past',
    counts: { expected: 2, attended: 1, missing: 1 },
    rows: [
      {
        ...ana,
        state: 'attended',
        assigned: true,
        enteredAt: '2026-11-02T15:05:00.000Z',
        exitedAt: '2026-11-02T15:50:00.000Z',
        source: 'manual',
        sessionStatus: 'cerrada',
      },
      { ...beto, state: 'missing', assigned: true },
    ],
    ...over,
  });

  it('asks for the chosen day and shows who attended and who did not', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({
      'GET /auth/me': account(),
      'GET /schedules': schedules,
      'GET /panel/schedules/s1/roster': () => json(roster()),
    });
    app(<Horarios />);
    await pickSchedule(user);
    expect(await screen.findByText('Pasado')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Listado del horario' });
    expect(within(table).getByText('Asistió')).toBeTruthy();
    expect(within(table).getByText('Faltó')).toBeTruthy();
    expect(within(table).getByText('Manual')).toBeTruthy();
    expect(within(table).getByText(/10:05 – 10:50/)).toBeTruthy();

    await user.click(screen.getByLabelText('Fecha'));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /^lunes 9 de noviembre de 2026/,
      }),
    );
    await waitFor(() =>
      expect(
        new URL(
          fake.calls('GET /panel/schedules/s1/roster').at(-1)!.url,
        ).searchParams.get('date'),
      ).toBe('2026-11-09'),
    );
  });

  it('tells, without error, that the day has no session', async () => {
    const user = userEvent.setup();
    installFakeApi({
      'GET /auth/me': account(),
      'GET /schedules': schedules,
      'GET /panel/schedules/s1/roster': roster({
        occurrence: null,
        phase: null,
        rows: [],
        counts: { expected: 0, attended: 0, missing: 0 },
      }),
    });
    app(<Horarios />);
    await pickSchedule(user);
    expect(await screen.findByText(/no tiene una sesión el/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('student card in «Ahora» (R14-R17)', () => {
  const setup = () =>
    installFakeApi({
      'GET /auth/me': account(),
      'GET /panel/now': snapshot({ inside: [inside], missing: [beto] }),
      'GET /students': [
        {
          id: 'b',
          name: 'Beto Ruiz',
          document: '2',
          active: true,
          program: 'Derecho',
        },
      ],
    });

  it('opens from a «Faltan» row, shows the fingerprint state and goes to enroll', async () => {
    const user = userEvent.setup();
    nav.push.mockReset();
    setup();
    app(<Ahora />);
    const faltan = await screen.findByRole('region', { name: 'Faltan' });
    const row = within(faltan).getByRole('button', {
      name: 'Ver ficha de Beto Ruiz',
    });
    await user.click(row);
    const sheet = await screen.findByRole('dialog', {
      name: 'Ficha de Beto Ruiz',
    });
    expect(within(sheet).getByText('Aún no llega')).toBeTruthy();
    expect(within(sheet).getByText('Sin huella')).toBeTruthy();
    expect(await within(sheet).findByText('Derecho')).toBeTruthy();
    await user.click(
      within(sheet).getByRole('button', { name: 'Asignar huella' }),
    );
    expect(nav.push).toHaveBeenCalledWith('/enrolar?estudiante=b');
  });

  it('offers to register again when there is a fingerprint, and returns the focus on Escape', async () => {
    const user = userEvent.setup();
    setup();
    app(<Ahora />);
    const dentro = await screen.findByRole('region', { name: 'Dentro' });
    const row = within(dentro).getByRole('button', {
      name: 'Ver ficha de Ana Gómez',
    });
    row.focus();
    await user.keyboard('{Enter}');
    const sheet = await screen.findByRole('dialog', {
      name: 'Ficha de Ana Gómez',
    });
    expect(within(sheet).getByText(/Dentro desde/)).toBeTruthy();
    expect(
      within(sheet).getByRole('button', { name: 'Volver a registrar huella' }),
    ).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(row);
  });
});

describe('enroll preselection (R18)', () => {
  const students = [
    {
      id: 'a',
      name: 'Ana Gómez',
      document: '1',
      active: true,
      consented: true,
      displayName: 'ANA',
      email: null,
      phone: null,
      program: null,
    },
  ];
  const setup = () =>
    installFakeApi({
      'GET /auth/me': account(),
      'GET /students': students,
      'GET /panel/fingerprints': { studentIds: [] },
    });

  it('shows the student already chosen when the id is valid', async () => {
    nav.search = '?estudiante=a';
    setup();
    app(<Enrolar />);
    expect(
      await screen.findByRole('button', { name: 'Cambiar estudiante' }),
    ).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Iniciar enrolamiento' }),
    ).toBeTruthy();
  });

  it('ignores an unknown id', async () => {
    nav.search = '?estudiante=zzz';
    setup();
    app(<Enrolar />);
    await screen.findByText('Ana Gómez');
    expect(
      screen.queryByRole('button', { name: 'Cambiar estudiante' }),
    ).toBeNull();
  });
});
