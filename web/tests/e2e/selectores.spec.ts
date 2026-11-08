import {
  control,
  dayButton,
  expect,
  loginAndWait,
  pickDay,
  showMonth,
  test,
} from './support';

/**
 * Date and schedule pickers in the real browser. The browser runs in Tokyo on
 * purpose: the days must still be the Bogota ones.
 */
test.describe('selectores de fecha y de horario', () => {
  test.describe('con el semestre simulado', () => {
    test.beforeEach(async ({ request }) => {
      await control(request, 'semester');
    });

    test('Reportes: rango con dos clics, fuera del periodo y atajo', async ({
      page,
    }) => {
      await loginAndWait(page, 'boss');
      await page.goto('/admin/reportes');
      await expect(
        page.getByRole('region', { name: 'Entradas por hora' }),
      ).toBeVisible();

      await page.getByLabel('Desde').click();
      await pickDay(page, '2026-03-02');
      // One click only: nothing is queried yet.
      await expect(page).not.toHaveURL(/desde=/);
      await expect(page.getByRole('status').last()).toHaveText(
        'Elija el último día.',
      );
      await pickDay(page, '2026-03-06');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/desde=2026-03-02/);
      await expect(page).toHaveURL(/hasta=2026-03-06/);
      await expect(page.getByLabel('Desde')).toContainText('2 mar 2026');
      await expect(page.getByLabel('Hasta')).toContainText('6 mar 2026');

      // A day after the end of the period cannot be chosen.
      await page.getByLabel('Hasta').click();
      await showMonth(page, '2026-06-01');
      await expect(dayButton(page, '2026-06-01')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await page.keyboard.press('Escape');
      await expect(page.getByLabel('Hasta')).toBeFocused();

      await page.getByLabel('Desde').click();
      await page.getByRole('button', { name: 'Todo el periodo' }).click();
      await expect(page).toHaveURL(/desde=2026-02-02/);
      await expect(page).toHaveURL(/hasta=2026-05-29/);
    });

    test('Historial: horario elegido por día y luego por hora', async ({
      page,
    }) => {
      await loginAndWait(page, 'boss');
      await page.goto('/admin/historial');
      const filters = page.getByRole('region', { name: 'Filtros' });
      await filters.getByLabel('Horario').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('option', { name: /^lunes/ }).click();
      await dialog.getByRole('option', { name: /06:00/ }).first().click();
      await expect(dialog).toHaveCount(0);
      await expect(filters.getByLabel('Horario')).toContainText('Lun 06:00');
      await filters.getByLabel('Horario').click();
      await page.getByRole('button', { name: 'Todos los horarios' }).click();
      await expect(filters.getByLabel('Horario')).toContainText(
        'Todos los horarios',
      );
    });

    test('Reportes cabe en un móvil', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await loginAndWait(page, 'boss');
      await page.goto('/admin/reportes');
      await page.getByLabel('Hasta').click();
      const box = await page.getByRole('dialog').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    });
  });

  test('Periodos: día sin servicio marcado y días fuera del periodo', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'boss');
    await page
      .getByRole('navigation', { name: 'Secciones' })
      .getByRole('link', { name: 'Periodos' })
      .click();
    await page.getByRole('button', { name: 'Nuevo periodo' }).click();
    const newPeriod = page.getByRole('form', { name: 'Nuevo periodo' });
    await newPeriod.getByLabel('Nombre').fill('2026-S');
    await newPeriod.getByLabel('Primer día').click();
    await pickDay(page, '2026-11-02');
    await pickDay(page, '2026-12-04');
    await newPeriod.getByRole('button', { name: 'Crear periodo' }).click();
    const exception = page.getByRole('form', {
      name: 'Agregar día sin servicio a 2026-S',
    });
    await exception.getByLabel('Desde').click();
    await pickDay(page, '2026-11-16');
    await pickDay(page, '2026-11-17');
    await exception.getByLabel('Motivo').fill('Festivo');
    await exception
      .getByRole('button', { name: 'Agregar día sin servicio' })
      .click();
    await expect(page.getByText('Ocurrencias actualizadas')).toBeVisible();

    await exception.getByLabel('Desde').click();
    await showMonth(page, '2026-11-16');
    await expect(dayButton(page, '2026-11-16')).toHaveAccessibleName(
      /día sin servicio/,
    );
    await showMonth(page, '2026-12-10');
    await expect(dayButton(page, '2026-12-10')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('asistente: Quiénes asistieron con horario por día y fecha', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'ana');
    await page
      .getByRole('navigation', { name: 'Secciones' })
      .getByRole('link', { name: 'Horarios' })
      .click();
    const query = page.getByRole('region', { name: 'Consulta' });
    await query.getByLabel('Horario').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('option', { name: /Grupo A/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(query.getByLabel('Horario')).toContainText('Grupo A');
    await query.getByLabel('Fecha').click();
    await pickDay(page, '2026-11-02');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(query.getByLabel('Fecha')).toContainText('2 nov 2026');
    await expect(
      query.getByRole('table', { name: 'Listado del horario' }),
    ).toBeVisible();
  });
});
