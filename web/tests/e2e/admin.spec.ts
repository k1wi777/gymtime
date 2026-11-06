import { expect, loginAndWait, test } from './support';

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
    const newPeriod = page.getByRole('form', { name: 'Nuevo periodo' });
    await newPeriod.getByLabel('Nombre').fill('2026-2');
    await newPeriod.getByLabel('Primer día').fill('2026-11-02');
    await newPeriod.getByLabel('Último día').fill('2026-12-04');
    await newPeriod.getByRole('button', { name: 'Crear periodo' }).click();
    const section = page.getByRole('region', { name: 'Periodo 2026-2' });
    await expect(section).toBeVisible();
    await section.getByRole('button', { name: 'Activar', exact: true }).click();
    await expect(section.getByText('Activo', { exact: true })).toBeVisible();

    const exception = section.getByRole('form', {
      name: 'Agregar día sin servicio a 2026-2',
    });
    await exception.getByLabel('Desde').fill('2026-11-16');
    await exception.getByLabel('Hasta').fill('2026-11-16');
    await exception.getByLabel('Motivo').fill('Festivo');
    await exception
      .getByRole('button', { name: 'Agregar día sin servicio' })
      .click();
    await expect(page.getByText('Ocurrencias actualizadas')).toBeVisible();
    await expect(section.getByText(/Festivo/)).toBeVisible();

    // Weekly schedule inside the period.
    await menu.getByRole('link', { name: 'Gestión de horarios' }).click();
    await page.getByRole('button', { name: 'Nuevo horario' }).click();
    const form = page.getByRole('form', { name: 'Nuevo horario' });
    await form.getByLabel('Nombre').fill('Lunes noche');
    await form.getByLabel('Día de la semana').selectOption('1');
    await form.getByLabel('Inicio').fill('18:00');
    await form.getByLabel('Fin').fill('19:00');
    await form.getByRole('button', { name: 'Crear horario' }).click();
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

    // Assign the imported students by document.
    await menu.getByRole('link', { name: 'Gestión de horarios' }).click();
    await page
      .getByRole('region', { name: 'Horario Lunes noche' })
      .getByRole('button', { name: 'Estudiantes' })
      .click();
    await page
      .getByLabel('Asignar varios por documento')
      .fill('2001\n2003\n9999');
    await page.getByRole('button', { name: 'Asignar lista' }).click();
    const result = page.getByRole('status').filter({
      hasText: 'Resultado de la asignación',
    });
    await expect(result.getByText(/Asignados: 2/)).toBeVisible();
    await expect(result.getByText(/No existen: 9999/)).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Horario Lunes noche' })
        .getByText('Gina Torres'),
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
