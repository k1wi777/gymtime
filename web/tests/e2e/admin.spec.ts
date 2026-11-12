import { expect, loginAndWait, pickDay, test } from './support';

const CSV = [
  'cedula,nombre,correo',
  '2001,Gina Torres,gina@example.com',
  '2002,Hugo Páez,no-es-un-correo',
  '2003,Inés Rojas,ines@example.com',
].join('\n');

test.describe('administrador: periodo, horario, importación y asignación (H9)', () => {
  test('creates a period, a schedule, imports a CSV with a bad row and assigns the students', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'boss');
    const menu = page.getByRole('navigation', { name: 'Secciones' });

    // Period with a day without service.
    await menu.getByRole('link', { name: 'Periodos' }).click();
    await page.getByRole('button', { name: 'Nuevo periodo' }).click();
    const newPeriod = page.getByRole('dialog', { name: 'Nuevo periodo' });
    await newPeriod.getByLabel('Nombre').fill('2026-2');
    await newPeriod.getByLabel('Primer día').click();
    await pickDay(page, '2026-11-02');
    await pickDay(page, '2026-12-04');
    await newPeriod.getByRole('button', { name: 'Crear periodo' }).click();
    const section = page.getByRole('region', { name: 'Periodo 2026-2' });
    await expect(section).toBeVisible();
    await section.getByRole('button', { name: 'Activar', exact: true }).click();
    await expect(section.getByText('Activo', { exact: true })).toBeVisible();

    const exception = page.getByRole('form', {
      name: 'Agregar día sin servicio a 2026-2',
    });
    await exception.getByLabel('Desde').click();
    await pickDay(page, '2026-11-16');
    await pickDay(page, '2026-11-16');
    await exception.getByLabel('Motivo').fill('Festivo');
    await exception
      .getByRole('button', { name: 'Agregar día sin servicio' })
      .click();
    await expect(page.getByText('Ocurrencias actualizadas')).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Días sin servicio' })
        .getByText(/Festivo/),
    ).toBeVisible();

    // Weekly schedule inside the period.
    await menu.getByRole('link', { name: 'Gestión de horarios' }).click();
    await page.getByRole('button', { name: 'Nuevo horario' }).click();
    const form = page.getByRole('dialog', { name: 'Nuevo horario' });
    await form.getByLabel('Nombre').fill('Lunes noche');
    await form.getByLabel('Día de la semana').selectOption('1');
    await form.getByLabel('Inicio').fill('18:00');
    await form.getByLabel('Fin').fill('19:00');
    await form.getByRole('button', { name: 'Crear horario' }).click();
    await expect(form).toHaveCount(0);
    const schedule = page.getByRole('region', { name: 'Horario Lunes noche' });
    await expect(schedule).toBeVisible();
    await expect(page.getByText('Ocurrencias actualizadas')).toBeVisible();

    // CSV import: the bad row is reported, the valid ones are created.
    await menu.getByRole('link', { name: 'Estudiantes' }).click();
    await page.getByRole('button', { name: 'Importar CSV' }).click();
    await page.getByLabel('Archivo CSV').setInputFiles({
      name: 'clase.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV, 'utf-8'),
    });
    await page.getByRole('button', { name: 'Ver vista previa' }).click();
    const errors = page.getByRole('table', { name: 'Filas con errores' });
    await expect(errors.getByText('3', { exact: true })).toBeVisible();
    await expect(errors.getByText(/formato válido/)).toBeVisible();
    await page
      .getByRole('button', { name: 'Importar 2 estudiante(s)' })
      .click();
    await expect(page.getByText('Importación terminada')).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Gina Torres', exact: true }),
    ).toBeVisible();

    // Add the imported students from the search and from a file.
    await menu.getByRole('link', { name: 'Gestión de horarios' }).click();
    await page
      .getByRole('region', { name: 'Horario Lunes noche' })
      .getByRole('button', { name: 'Estudiantes' })
      .click();
    const assign = page.getByRole('dialog', {
      name: 'Estudiantes del horario',
    });
    await assign.getByRole('button', { name: 'Agregar estudiantes' }).click();
    const add = page.getByRole('dialog', { name: 'Agregar estudiantes' });
    await add.getByRole('combobox').fill('Gina');
    await add.getByRole('option', { name: /Gina Torres/ }).click();
    await expect(add.getByText('Para agregar (1)')).toBeVisible();
    await add.getByTestId('students-file').setInputFiles({
      name: 'lunes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('2003\n9999\n', 'utf-8'),
    });
    await expect(add.getByText(/Del archivo «lunes.csv»/)).toBeVisible();
    await expect(add.getByText(/1 no se encontró/)).toBeVisible();
    await add.getByRole('button', { name: /^Agregar \d+ estudiante/ }).click();
    await expect(add).toHaveCount(0);
    await expect(assign.getByText('Gina Torres')).toBeVisible();
    await assign
      .getByRole('button', { name: 'Cerrar', exact: true })
      .last()
      .click();
    await expect(assign).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'Horario Lunes noche' })
        .getByText('2 estudiantes'),
    ).toBeVisible();
  });

  test('an assistant does not see the administrator menu nor open its routes', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'ana');
    const menu = page.getByRole('navigation', { name: 'Secciones' });
    await expect(menu.getByRole('link', { name: 'Auditoría' })).toHaveCount(0);
    await page.goto('/admin/usuarios');
    await expect(page.getByText('Sin permiso')).toBeVisible();
  });
});
