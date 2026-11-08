import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/auth/auth-provider';
import { RequireRole } from '@/auth/RequireRole';
import { visibleItems } from '@/lib/nav';
import { Auditoria } from '@/features/admin/Auditoria';
import { Estudiantes } from '@/features/admin/Estudiantes';
import { Historial } from '@/features/admin/Historial';
import {
  HorariosAdmin,
  parseDocuments,
  validFromOf,
} from '@/features/admin/HorariosAdmin';
import { Periodos, validatePeriod } from '@/features/admin/Periodos';
import { Usuarios } from '@/features/admin/Usuarios';
import { account, empty, installFakeApi, json, pinToday } from './helpers';

const admin = account({
  id: 'admin-1',
  name: 'Ada Admin',
  username: 'ada',
  role: 'admin',
});

const app = (children: ReactNode) =>
  render(<AuthProvider>{children}</AuthProvider>);

const period = {
  id: 'p1',
  name: '2026-2',
  startDate: '2026-08-03',
  endDate: '2026-11-27',
  active: true,
  schedulesCount: 1,
  exceptions: [
    { id: 'x1', from: '2026-11-16', to: '2026-11-16', reason: 'Festivo' },
  ],
};

/** The date or schedule popover (the modal is a dialog too). */
const popover = () =>
  document.body.querySelector<HTMLElement>(
    'body > [role="dialog"][data-side]',
  ) as HTMLElement;

const regeneration = { created: 4, deleted: 1, updated: 0, kept: 2 };

describe('administrator navigation (R6)', () => {
  it('shows the administrator entries only to the administrator', () => {
    const assistant = visibleItems('asistente').map((i) => i.href);
    expect(assistant.some((href) => href.startsWith('/admin'))).toBe(false);
    const hrefs = visibleItems('admin').map((i) => i.href);
    for (const route of [
      '/admin/periodos',
      '/admin/horarios',
      '/admin/estudiantes',
      '/admin/usuarios',
      '/admin/historial',
      '/admin/auditoria',
    ]) {
      expect(hrefs).toContain(route);
    }
  });

  it('does not open an administrator screen for an assistant', async () => {
    installFakeApi({ 'GET /auth/me': account() });
    app(
      <RequireRole roles={['admin']}>
        <Periodos />
      </RequireRole>,
    );
    expect(await screen.findByText('Sin permiso')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Periodos' })).toBeNull();
  });
});

describe('periods (R1-R4)', () => {
  const setup = () =>
    installFakeApi({ 'GET /auth/me': admin, 'GET /periods': [period] });

  it('validates the dates before sending', () => {
    expect(
      validatePeriod({
        name: 'x',
        startDate: '2026-02-02',
        endDate: '2026-01-01',
      }).endDate,
    ).toMatch(/anterior/);
    expect(
      validatePeriod({ name: '', startDate: '', endDate: '' }),
    ).toMatchObject({
      name: expect.any(String),
      startDate: expect.any(String),
      endDate: expect.any(String),
    });
  });

  it('creates a period and shows the server message when it overlaps', async () => {
    pinToday();
    const user = userEvent.setup();
    const fake = setup();
    fake.route('POST /periods', () =>
      json(
        {
          statusCode: 409,
          code: 'PERIOD_OVERLAP',
          message:
            'Las fechas se cruzan con el periodo "2026-2" (2026-08-03 a 2026-11-27)',
        },
        409,
      ),
    );
    app(<Periodos />);
    await user.click(
      await screen.findByRole('button', { name: 'Nuevo periodo' }),
    );
    await user.type(screen.getByLabelText('Nombre'), '2027-1');
    await user.click(screen.getByLabelText('Primer día'));
    await user.click(
      within(popover()).getByRole('button', {
        name: /^domingo 1 de noviembre de 2026/,
      }),
    );
    const calendar = within(popover());
    for (let i = 0; i < 3; i += 1) {
      await user.click(calendar.getByRole('button', { name: 'Mes siguiente' }));
    }
    await user.click(
      calendar.getByRole('button', { name: /^lunes 1 de febrero de 2027/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Crear periodo' }));
    // The form lives in a modal and the error stays inside it.
    const modal = screen.getByRole('dialog', { name: 'Nuevo periodo' });
    // The message names the period that clashes, so it must come through.
    expect(
      await screen.findByText(/se cruzan con el periodo "2026-2"/),
    ).toBeTruthy();
    expect(
      within(modal).getByText(/se cruzan con el periodo "2026-2"/),
    ).toBeTruthy();
    expect(await fake.calls('POST /periods')[0]?.json()).toEqual({
      name: '2027-1',
      startDate: '2026-11-01',
      endDate: '2027-02-01',
    });
  });

  it('edits the dates in a modal, closes it on success and keeps the notice', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('PATCH /periods/p1', () =>
      json({ ...period, regeneration }, 200),
    );
    app(<Periodos />);
    await user.click(
      await screen.findByRole('button', { name: 'Editar fechas' }),
    );
    expect(screen.getByRole('dialog', { name: 'Editar fechas' })).toBeTruthy();
    await user.type(screen.getByLabelText('Nombre'), ' b');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Ocurrencias actualizadas')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Editar fechas' })).toBeNull();
    expect(fake.calls('PATCH /periods/p1')).toHaveLength(1);
  });

  it('shows created/deleted/kept after adding a day without service', async () => {
    pinToday();
    const user = userEvent.setup();
    const fake = setup();
    fake.route('POST /periods/p1/exceptions', () =>
      json(
        {
          exception: {
            id: 'x2',
            from: '2026-11-02',
            to: '2026-11-02',
            reason: 'Puente',
          },
          regeneration,
        },
        201,
      ),
    );
    app(<Periodos />);
    const form = await screen.findByRole('form', {
      name: 'Agregar día sin servicio a 2026-2',
    });
    await user.click(within(form).getByLabelText('Desde'));
    const monday = within(screen.getByRole('dialog')).getByRole('button', {
      name: /^lunes 2 de noviembre de 2026/,
    });
    await user.click(monday);
    await user.click(monday);
    await user.type(within(form).getByLabelText('Motivo'), 'Puente');
    await user.click(
      within(form).getByRole('button', { name: 'Agregar día sin servicio' }),
    );
    const notice = await screen.findByText('Ocurrencias actualizadas');
    const box = notice.closest('[role="status"]') as HTMLElement;
    expect(within(box).getByText(/Creadas/).textContent).toContain('4');
    expect(within(box).getByText(/Borradas/).textContent).toContain('1');
    expect(within(box).getByText(/Conservadas/).textContent).toContain('2');
  });

  it('asks before deleting a period and deletes only after confirming', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('DELETE /periods/p1', () => empty());
    app(<Periodos />);
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    expect(fake.calls('DELETE /periods/p1')).toHaveLength(0);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() =>
      expect(fake.calls('DELETE /periods/p1')).toHaveLength(1),
    );
  });
});

describe('schedules (R7-R11)', () => {
  const schedule = {
    id: 's1',
    name: 'Lunes tarde',
    weekday: 1,
    date: null,
    startTime: '18:00:00',
    endTime: '19:00:00',
    entryOpenMinutes: null,
    entryCloseMinutes: null,
    periodId: 'p1',
    students: [{ id: 'st1', document: '1001', name: 'Ana', active: true }],
    upcoming: [],
  };
  const setup = () =>
    installFakeApi({
      'GET /auth/me': admin,
      'GET /periods': [period],
      'GET /schedules': [schedule],
      'GET /students': [],
    });

  it('parses pasted documents and the validity date', () => {
    expect(parseDocuments('1001\n1002, 1001;  1003 \n')).toEqual([
      '1001',
      '1002',
      '1003',
    ]);
    expect(validFromOf('2026-11-02', '2026-11-02')).toBeUndefined();
    expect(validFromOf('2026-11-09', '2026-11-02')).toBe(
      '2026-11-09T00:00:00-05:00',
    );
  });

  it('shows who was assigned, already assigned, inactive and not found', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('POST /schedules/s1/students/bulk', () =>
      json({
        assigned: [{ id: 'a', document: '1002', name: 'Luis' }],
        alreadyAssigned: [{ id: 'st1', document: '1001', name: 'Ana' }],
        inactive: [{ id: 'c', document: '1003', name: 'Eva' }],
        notFound: ['9999'],
      }),
    );
    app(<HorariosAdmin />);
    await user.click(
      await screen.findByRole('button', { name: 'Estudiantes' }),
    );
    await user.type(
      screen.getByLabelText('Asignar varios por documento'),
      '1001{enter}1002{enter}1003{enter}9999',
    );
    await user.click(screen.getByRole('button', { name: 'Asignar lista' }));
    const result = await screen.findByText('Resultado de la asignación');
    const box = result.closest('[role="status"]') as HTMLElement;
    expect(within(box).getByText(/No existen/).textContent).toContain('9999');
    expect(within(box).getByText(/De baja/).textContent).toContain('1003');
    expect(
      await fake.calls('POST /schedules/s1/students/bulk')[0]?.json(),
    ).toEqual({
      documents: ['1001', '1002', '1003', '9999'],
    });
  });

  describe('day filter and weekly view (R17-R23)', () => {
    const more = (
      id: string,
      name: string,
      weekday: number,
      start: string,
    ) => ({
      ...schedule,
      id,
      name,
      weekday,
      startTime: `${start}:00`,
      endTime: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:${start.slice(3)}:00`,
      students: [],
    });
    const several = () => {
      const fake = installFakeApi({
        'GET /auth/me': admin,
        'GET /periods': [period],
        'GET /schedules': [
          more('s3', 'Miércoles', 3, '07:00'),
          more('s2', 'Martes tarde', 2, '18:00'),
          more('s4', 'Martes mañana', 2, '06:00'),
        ],
        'GET /students': [],
      });
      return fake;
    };
    const names = () =>
      screen
        .queryAllByRole('region')
        .map((node) => node.getAttribute('aria-label'))
        .filter((label) => label?.startsWith('Horario '));

    it('starts on the first day with schedules, below the period selector', async () => {
      several();
      app(<HorariosAdmin />);
      const group = await screen.findByRole('radiogroup', { name: 'Día' });
      const radios = within(group).getAllByRole('radio');
      expect(radios.map((r) => r.textContent)).toEqual([
        'MartesMar2',
        'MiércolesMié1',
        'TodosTodos3',
      ]);
      expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
      expect(names()).toEqual([
        'Horario Martes mañana',
        'Horario Martes tarde',
      ]);
      const period = screen.getByLabelText('Periodo');
      expect(
        period.compareDocumentPosition(group) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // With a day active the weekly view stays underneath, with totals.
      expect(
        screen.getByRole('region', { name: 'Vista semanal' }),
      ).toBeTruthy();
      expect(screen.queryByText('Semana anterior')).toBeNull();
    });

    it('lists only the chosen day and moves with the arrows', async () => {
      const user = userEvent.setup();
      several();
      app(<HorariosAdmin />);
      const group = await screen.findByRole('radiogroup', { name: 'Día' });
      await user.click(within(group).getByRole('radio', { name: /Miércoles/ }));
      expect(names()).toEqual(['Horario Miércoles']);
      await user.keyboard('{ArrowRight}');
      expect(
        within(group)
          .getByRole('radio', { name: /Todos/ })
          .getAttribute('aria-checked'),
      ).toBe('true');
      await user.keyboard('{Home}');
      expect(names()).toHaveLength(2);
    });

    it('«Todos» shows the weekly view once, with Estudiantes and Más per slot', async () => {
      const user = userEvent.setup();
      const fake = several();
      fake.route('DELETE /schedules/s3', () => empty());
      app(<HorariosAdmin />);
      const group = await screen.findByRole('radiogroup', { name: 'Día' });
      await user.click(within(group).getByRole('radio', { name: /Todos/ }));
      expect(names()).toEqual([]);
      expect(
        screen.getAllByRole('region', { name: 'Vista semanal' }),
      ).toHaveLength(1);
      expect(screen.queryByText(/Semana del/)).toBeNull();
      expect(screen.queryByText('Anterior')).toBeNull();
      expect(screen.queryByText(/estudiantes$/)).toBeNull();
      expect(screen.getByText('2 horarios')).toBeTruthy();
      expect(fake.calls('GET /panel/schedules/week')).toHaveLength(0);

      // «Más» menu: keyboard, Escape and the actions.
      const more = screen.getByRole('button', {
        name: 'Más acciones de miércoles 07:00–08:00',
      });
      await user.click(more);
      expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).toBeNull();
      await user.click(more);
      await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
      const edit = screen.getByRole('dialog', { name: 'Editar Miércoles' });
      expect(
        (within(edit).getByLabelText('Nombre') as HTMLInputElement).value,
      ).toBe('Miércoles');
      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(more);

      await user.click(more);
      await user.click(screen.getByRole('menuitem', { name: 'Eliminar' }));
      await user.click(
        within(
          screen.getByRole('dialog', { name: 'Eliminar horario' }),
        ).getByRole('button', { name: 'Eliminar' }),
      );
      await waitFor(() =>
        expect(fake.calls('DELETE /schedules/s3')).toHaveLength(1),
      );

      await user.click(
        screen.getByRole('button', { name: 'Estudiantes martes 06:00–07:00' }),
      );
      expect(
        screen.getByRole('dialog', { name: 'Estudiantes de Martes mañana' }),
      ).toBeTruthy();
    });

    it('goes back to the first day with schedules when the active day empties', async () => {
      const user = userEvent.setup();
      const fake = several();
      app(<HorariosAdmin />);
      const group = await screen.findByRole('radiogroup', { name: 'Día' });
      await user.click(within(group).getByRole('radio', { name: /Miércoles/ }));
      fake.route('GET /schedules', [
        more('s2', 'Martes tarde', 2, '18:00'),
        more('s4', 'Martes mañana', 2, '06:00'),
      ]);
      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
      fake.route('DELETE /schedules/s3', () => empty());
      await user.click(
        within(
          screen.getByRole('dialog', { name: 'Eliminar horario' }),
        ).getByRole('button', { name: 'Eliminar' }),
      );
      await waitFor(() => expect(names()).toHaveLength(2));
      const radios = within(
        screen.getByRole('radiogroup', { name: 'Día' }),
      ).getAllByRole('radio');
      expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
      expect(radios).toHaveLength(2);
    });

    it('shows the empty state without pills for a period with no schedules', async () => {
      installFakeApi({
        'GET /auth/me': admin,
        'GET /periods': [period],
        'GET /schedules': [],
        'GET /students': [],
      });
      app(<HorariosAdmin />);
      expect(
        await screen.findByText('Este periodo no tiene horarios.'),
      ).toBeTruthy();
      expect(screen.queryByRole('radiogroup')).toBeNull();
    });
  });

  it('shows the server message when the schedule overlaps another', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('POST /schedules', () =>
      json(
        {
          statusCode: 409,
          code: 'SCHEDULE_OVERLAP',
          message: 'El horario se cruza con "Lunes tarde"',
        },
        409,
      ),
    );
    app(<HorariosAdmin />);
    await user.click(
      await screen.findByRole('button', { name: 'Nuevo horario' }),
    );
    const form = screen.getByRole('dialog', { name: 'Nuevo horario' });
    await user.type(within(form).getByLabelText('Nombre'), 'Otro');
    await user.selectOptions(
      within(form).getByLabelText('Día de la semana'),
      '1',
    );
    await user.type(within(form).getByLabelText('Inicio'), '18:30');
    await user.type(within(form).getByLabelText('Fin'), '19:30');
    await user.click(
      within(form).getByRole('button', { name: 'Crear horario' }),
    );
    expect(
      await screen.findByText('El horario se cruza con "Lunes tarde"'),
    ).toBeTruthy();
    expect(await fake.calls('POST /schedules')[0]?.json()).toMatchObject({
      periodId: 'p1',
      weekday: 1,
    });
  });
});

describe('students (R12, R13, R16, R17)', () => {
  const fields = [
    {
      key: 'document',
      label: 'Documento',
      required: true,
      editable: false,
      help: '',
      example: '1',
    },
    {
      key: 'name',
      label: 'Nombre',
      required: true,
      editable: true,
      help: '',
      example: 'A',
    },
    {
      key: 'displayName',
      label: 'Nombre en pantalla',
      required: false,
      editable: true,
      help: '',
      example: '',
    },
  ];
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'st1',
    document: '1001',
    name: 'Ana Gómez',
    program: 'Ingeniería',
    email: null,
    phone: null,
    displayName: 'ANA',
    active: true,
    consented: false,
    consentVersion: null,
    consentAt: null,
    fingerprintEnrolledAt: null,
    ...over,
  });
  const setup = () =>
    installFakeApi({
      'GET /auth/me': admin,
      'GET /students/import/fields': fields,
      'GET /panel/students': { items: [row()], total: 1 },
    });
  const lastQuery = (fake: ReturnType<typeof setup>) =>
    new URL(fake.calls('GET /panel/students').at(-1)?.url ?? '').searchParams;

  it('sends the search and the "without fingerprint" filter to the server', async () => {
    const user = userEvent.setup();
    const fake = setup();
    app(<Estudiantes />);
    await screen.findByText('Ana Gómez');
    await user.type(
      screen.getByLabelText('Buscar por nombre o documento'),
      'ana',
    );
    await waitFor(() => expect(lastQuery(fake).get('search')).toBe('ana'));
    await user.selectOptions(screen.getByLabelText('Huella'), 'none');
    await waitFor(() =>
      expect(lastQuery(fake).get('fingerprint')).toBe('none'),
    );
  });

  it('builds the form from the server fields and limits the screen name to 16', async () => {
    const user = userEvent.setup();
    const fake = setup();
    app(<Estudiantes />);
    await user.click(
      await screen.findByRole('button', { name: 'Nuevo estudiante' }),
    );
    const form = screen.getByRole('dialog', { name: 'Nuevo estudiante' });
    await user.type(within(form).getByLabelText('Documento *'), '1002');
    await user.type(within(form).getByLabelText('Nombre *'), 'Luis');
    await user.type(
      within(form).getByLabelText('Nombre en pantalla'),
      'ABCDEFGHIJKLMNOPQ',
    );
    await user.click(
      within(form).getByRole('button', { name: 'Crear estudiante' }),
    );
    expect(
      await within(form).findByText('Admite hasta 16 caracteres.'),
    ).toBeTruthy();
    expect(fake.calls('POST /students')).toHaveLength(0);
  });

  it('creates a student from the modal, which closes and refreshes the list', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('POST /students', () => json(row({ id: 'st2' }), 201));
    app(<Estudiantes />);
    await user.click(
      await screen.findByRole('button', { name: 'Nuevo estudiante' }),
    );
    const modal = screen.getByRole('dialog', { name: 'Nuevo estudiante' });
    await user.type(within(modal).getByLabelText('Documento *'), '1002');
    await user.type(within(modal).getByLabelText('Nombre *'), 'Luis');
    await user.click(
      within(modal).getByRole('button', { name: 'Crear estudiante' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Nuevo estudiante' }),
      ).toBeNull(),
    );
    expect(fake.calls('POST /students')).toHaveLength(1);
    expect(fake.calls('GET /panel/students').length).toBeGreaterThan(1);
  });

  it('edits a student in a modal, which closes and refreshes the list', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('PATCH /students/st1', () => json(row({ name: 'Ana Pérez' })));
    app(<Estudiantes />);
    await user.click(
      await screen.findByRole('button', { name: 'Editar a Ana Gómez' }),
    );
    const modal = screen.getByRole('dialog', { name: 'Editar Ana Gómez' });
    expect(
      (within(modal).getByLabelText('Nombre *') as HTMLInputElement).value,
    ).toBe('Ana Gómez');
    expect(
      (within(modal).getByLabelText('Documento *') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    const name = within(modal).getByLabelText('Nombre *');
    await user.clear(name);
    await user.type(name, 'Ana Pérez');
    await user.click(
      within(modal).getByRole('button', { name: 'Guardar cambios' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Editar Ana Gómez' }),
      ).toBeNull(),
    );
    const patches = fake.calls('PATCH /students/st1');
    expect(patches).toHaveLength(1);
    expect(fake.calls('GET /panel/students').length).toBeGreaterThan(1);
  });

  it('keeps the edit modal open and shows the error when saving fails', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('PATCH /students/st1', () =>
      json({ statusCode: 404, code: 'STUDENT_NOT_FOUND', message: 'x' }, 404),
    );
    app(<Estudiantes />);
    await user.click(
      await screen.findByRole('button', { name: 'Editar a Ana Gómez' }),
    );
    const modal = screen.getByRole('dialog', { name: 'Editar Ana Gómez' });
    await user.type(within(modal).getByLabelText('Nombre *'), 'X');
    await user.click(
      within(modal).getByRole('button', { name: 'Guardar cambios' }),
    );
    expect(
      await within(modal).findByText('El estudiante no existe.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('dialog', { name: 'Editar Ana Gómez' }),
    ).toBeTruthy();
  });

  it('asks before discarding unsaved edits and closes freely without changes', async () => {
    const user = userEvent.setup();
    const fake = setup();
    app(<Estudiantes />);
    const open = await screen.findByRole('button', {
      name: 'Editar a Ana Gómez',
    });
    await user.click(open);
    let modal = screen.getByRole('dialog', { name: 'Editar Ana Gómez' });
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }));
    expect(
      screen.queryByRole('dialog', { name: 'Editar Ana Gómez' }),
    ).toBeNull();

    await user.click(open);
    modal = screen.getByRole('dialog', { name: 'Editar Ana Gómez' });
    await user.type(within(modal).getByLabelText('Nombre *'), 'X');
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('¿Descartar los cambios?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(
      screen.getByRole('dialog', { name: 'Editar Ana Gómez' }),
    ).toBeTruthy();
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Editar Ana Gómez' }),
      ).toBeNull(),
    );
    expect(fake.calls('PATCH /students/st1')).toHaveLength(0);
  });

  it('erases personal data only after typing the document (H11)', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('GET /panel/students', {
      items: [row({ document: '1001' })],
      total: 1,
    });
    fake.route('POST /students/st1/erase', () =>
      json({ studentId: 'st1', templatesDeleted: 1 }),
    );
    app(<Estudiantes />);
    await user.click(
      await screen.findByRole('button', { name: 'Más acciones de Ana Gómez' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Suprimir datos de Ana Gómez' }),
    );
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'Suprimir datos',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(
      within(dialog).getByLabelText('Escriba el documento para confirmar'),
      '9999',
    );
    expect(confirm.disabled).toBe(true);
    await user.clear(
      within(dialog).getByLabelText('Escriba el documento para confirmar'),
    );
    await user.type(
      within(dialog).getByLabelText('Escriba el documento para confirmar'),
      '1001',
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(fake.calls('POST /students/st1/erase')).toHaveLength(1),
    );
    expect(await fake.calls('POST /students/st1/erase')[0]?.json()).toEqual({
      confirmDocument: '1001',
    });
  });

  it('shows erased students as such, without edit or erase actions (H11)', async () => {
    const fake = setup();
    fake.route('GET /panel/students', {
      items: [
        row({
          name: 'Estudiante anonimizado',
          active: false,
          anonymizedAt: '2026-11-06T20:00:00.000Z',
        }),
      ],
      total: 1,
    });
    app(<Estudiantes />);
    expect(await screen.findByText('Datos suprimidos')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Suprimir datos de/ }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar a/ })).toBeNull();
  });

  it('records the consent with the version the server showed', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('GET /students/consent', {
      version: 'v1-provisional',
      text: 'Texto del servidor',
    });
    fake.route('POST /students/st1/consent', () =>
      json(row({ consented: true, consentVersion: 'v1-provisional' })),
    );
    app(<Estudiantes />);
    await user.click(
      await screen.findByRole('button', {
        name: 'Registrar consentimiento de Ana Gómez',
      }),
    );
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Texto del servidor')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', {
      name: 'Registrar consentimiento',
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(confirm);
    await waitFor(() =>
      expect(fake.calls('POST /students/st1/consent')).toHaveLength(1),
    );
    expect(await fake.calls('POST /students/st1/consent')[0]?.json()).toEqual({
      version: 'v1-provisional',
    });
  });

  it('imports a CSV: shows the bad rows and confirms only the valid ones', async () => {
    const user = userEvent.setup();
    const fake = setup();
    const summary = {
      total: 3,
      valid: 2,
      invalidRows: [
        {
          row: 3,
          errors: [
            { field: 'email', message: 'El correo no tiene un formato válido' },
          ],
        },
      ],
    };
    fake.route('POST /students/import/preview', async (request: Request) => {
      const body = (await request.json()) as { mapping?: unknown };
      return json({
        delimiter: ',',
        headers: ['cedula', 'nombre', 'correo'],
        suggestedMapping: {
          document: 0,
          name: 1,
          program: null,
          email: 2,
          phone: null,
          displayName: null,
        },
        sample: [['1', 'Ana', 'a@x.co']],
        ...(body.mapping ? { validation: summary } : {}),
      });
    });
    fake.route('POST /students/import', () =>
      json({
        batchId: 'b1',
        total: 3,
        created: 2,
        invalidRows: summary.invalidRows,
      }),
    );
    app(<Estudiantes />);
    await user.click(
      await screen.findByRole('button', { name: 'Importar CSV' }),
    );
    const file = new File(
      ['cedula,nombre,correo\n1,Ana,a@x.co\n'],
      'clase.csv',
      {
        type: 'text/csv',
      },
    );
    await user.upload(screen.getByLabelText('Archivo CSV'), file);
    // Step 2: the suggested mapping is editable and already filled.
    expect(await screen.findByText(/Indique qué columna/)).toBeTruthy();
    expect(
      (screen.getByLabelText(/^Documento/) as HTMLSelectElement).value,
    ).toBe('0');
    await user.click(screen.getByRole('button', { name: 'Ver vista previa' }));
    // Step 3: row and reason.
    const table = await screen.findByRole('table', {
      name: 'Filas con errores',
    });
    expect(within(table).getByText('3')).toBeTruthy();
    expect(
      within(table).getByText(/El correo no tiene un formato válido/),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Importar 2 estudiante(s)' }),
    );
    expect(await screen.findByText('Importación terminada')).toBeTruthy();
    const sent = (await fake.calls('POST /students/import')[0]?.json()) as {
      filename: string;
      mapping: Record<string, number | null>;
    };
    expect(sent.filename).toBe('clase.csv');
    expect(sent.mapping.email).toBe(2);
  });
});

describe('panel users (R18, R19)', () => {
  const users = [
    { ...admin },
    account({
      id: 'u2',
      name: 'Beto Asistente',
      username: 'beto',
      role: 'asistente',
    }),
  ];
  const setup = () =>
    installFakeApi({ 'GET /auth/me': admin, 'GET /users': users });

  it('shows the temporary password once and removes it on close', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('POST /users/u2/reset-password', () =>
      json({
        ...users[1],
        mustChangePassword: true,
        temporaryPassword: 'Tmp-Secreta-123',
      }),
    );
    app(<Usuarios />);
    await user.click(
      await screen.findByRole('button', {
        name: 'Restablecer contraseña de Beto Asistente',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Restablecer' }));
    expect(await screen.findByText('Tmp-Secreta-123')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() =>
      expect(screen.queryByText('Tmp-Secreta-123')).toBeNull(),
    );
    expect(document.body.textContent).not.toContain('Tmp-Secreta-123');
    expect(JSON.stringify(window.localStorage)).not.toContain('Tmp-Secreta');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('Tmp-Secreta');
  });

  it('creates a user in a modal and then shows the temporary password', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('POST /users', () =>
      json(
        {
          ...users[1],
          id: 'u3',
          username: 'carla',
          temporaryPassword: 'Tmp-Nueva-9',
        },
        201,
      ),
    );
    app(<Usuarios />);
    await user.click(
      await screen.findByRole('button', { name: 'Nuevo usuario' }),
    );
    const modal = screen.getByRole('dialog', { name: 'Nuevo usuario' });
    await user.type(within(modal).getByLabelText('Nombre'), 'Carla');
    await user.type(within(modal).getByLabelText('Usuario'), 'carla');
    await user.selectOptions(within(modal).getByLabelText('Rol'), 'asistente');
    await user.click(
      within(modal).getByRole('button', { name: 'Crear usuario' }),
    );
    expect(await screen.findByText('Tmp-Nueva-9')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Nuevo usuario' })).toBeNull();
  });

  it('blocks deactivating yourself and explains the last-administrator rule', async () => {
    const user = userEvent.setup();
    const fake = setup();
    fake.route('PATCH /users/u2', () =>
      json({ statusCode: 409, code: 'LAST_ADMIN', message: 'x' }, 409),
    );
    app(<Usuarios />);
    const self = await screen.findByRole('button', {
      name: 'Desactivar a Ada Admin',
    });
    expect((self as HTMLButtonElement).disabled).toBe(true);
    await user.click(
      screen.getByRole('button', { name: 'Desactivar a Beto Asistente' }),
    );
    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText(/sin un administrador activo/)).toBeTruthy();
  });
});

describe('history and audit (R20-R22)', () => {
  it('sends the attendance filters to the server and tells fingerprint from manual', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi({
      'GET /auth/me': admin,
      'GET /schedules': [],
      'GET /panel/attendance/history': {
        total: 1,
        items: [
          {
            id: 'r1',
            student: { id: 'st1', document: '1001', name: 'Ana Gómez' },
            schedule: { id: 's1', name: 'Lunes' },
            startsAt: '2026-11-02T23:00:00.000Z',
            enteredAt: '2026-11-02T23:05:00.000Z',
            exitedAt: null,
            entrySource: 'manual',
            exitSource: null,
            status: 'abierta',
            manualReason: 'El lector no respondía',
            entryBy: { type: 'user', id: 'u1', name: 'Carla' },
            exitBy: null,
          },
        ],
      },
    });
    app(<Historial />);
    expect(await screen.findByText('El lector no respondía')).toBeTruthy();
    const table = screen.getByRole('table', {
      name: 'Historial de ingresos y egresos',
    });
    expect(within(table).getByText('Manual')).toBeTruthy();
    expect(within(table).getByText('Carla')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Origen'), 'manual');
    await waitFor(() => {
      const query = new URL(
        fake.calls('GET /panel/attendance/history').at(-1)?.url ?? '',
      ).searchParams;
      expect(query.get('source')).toBe('manual');
    });
  });

  it('renders the audit detail as text and loads older pages with the cursor', async () => {
    const user = userEvent.setup();
    const item = (id: number, detail: unknown) => ({
      id,
      type: 'student.updated',
      createdAt: '2026-11-02T15:00:00.000Z',
      actor: { type: 'user', id: 'u1', name: 'Carla' },
      detail,
    });
    const fake = installFakeApi({
      'GET /auth/me': admin,
      'GET /users': [admin],
      'GET /audit': (request: Request) => {
        const before = new URL(request.url).searchParams.get('before');
        return json(
          before
            ? { items: [item(1, { fields: ['name'] })], nextBefore: null }
            : {
                items: [item(2, { note: '<img src=x onerror=alert(1)>' })],
                nextBefore: 2,
              },
        );
      },
    });
    const { container } = app(<Auditoria />);
    expect(
      await screen.findByText('<img src=x onerror=alert(1)>'),
    ).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Cargar más antiguos' }),
    );
    await waitFor(() =>
      expect(screen.getAllByText('student.updated')).toHaveLength(2),
    );
    expect(
      new URL(fake.calls('GET /audit').at(-1)?.url ?? '').searchParams.get(
        'before',
      ),
    ).toBe('2');
    expect(
      screen.queryByRole('button', { name: 'Cargar más antiguos' }),
    ).toBeNull();
  });
});
