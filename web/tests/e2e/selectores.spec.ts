import type { Locator, Page } from '@playwright/test';
import {
  control,
  dayButton,
  expect,
  loginAndWait,
  pickDay,
  showMonth,
  test,
} from './support';

/** The whole box of `locator` lies inside the viewport. */
async function expectInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const size = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
}

/**
 * Scrolls so `field` sits `gap` px above the bottom of the viewport. A field
 * that starts near the top needs room above it first.
 */
async function liftToBottom(page: Page, field: Locator, gap: number) {
  await field.evaluate((element, offset) => {
    const host = element.closest('main') ?? document.body;
    host.style.paddingTop = '900px';
    const top = element.getBoundingClientRect().top;
    window.scrollBy(0, top - (window.innerHeight - offset));
  }, gap);
}

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
      await expect(page.getByRole('dialog').getByRole('status')).toHaveText(
        'Ahora elige el día final',
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

    test('Reportes: cambiar solo «Hasta» o solo «Desde» sin repetir el rango', async ({
      page,
    }) => {
      await loginAndWait(page, 'boss');
      await page.goto('/admin/reportes');
      await page.getByLabel('Desde').click();
      await pickDay(page, '2026-03-02');
      await pickDay(page, '2026-03-06');
      await expect(page).toHaveURL(/hasta=2026-03-06/);

      // Only "Hasta": one click, "Desde" is kept and the panel closes.
      await page.getByLabel('Hasta').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('status')).toHaveText(
        'Elige el nuevo día final',
      );
      await pickDay(page, '2026-03-07');
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(/desde=2026-03-02/);
      await expect(page).toHaveURL(/hasta=2026-03-07/);
      await expect(page.getByLabel('Hasta')).toBeFocused();

      // Only "Desde": the panel stays open, now on "Hasta".
      await page.getByLabel('Desde').click();
      await pickDay(page, '2026-03-03');
      await expect(page).toHaveURL(/desde=2026-03-03/);
      await expect(page).toHaveURL(/hasta=2026-03-07/);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('status')).toHaveText(
        'Elige el nuevo día final',
      );

      // An inverted day equals the other end and says so.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await page.getByLabel('Desde').click();
      await pickDay(page, '2026-03-10');
      await expect(dialog.getByRole('status')).toContainText(
        '“Hasta” se ajustó al 10 mar 2026',
      );
      await expect(page).toHaveURL(/desde=2026-03-10/);
      await expect(page).toHaveURL(/hasta=2026-03-10/);
    });

    test('el calendario abre hacia arriba junto al borde inferior', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 640 });
      await loginAndWait(page, 'boss');
      await page.goto('/admin/reportes');
      const field = page.getByLabel('Desde');
      await liftToBottom(page, field, 90);
      await field.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('data-side', 'above');
      await expectInViewport(page, dialog);
      // Portalled: no card with overflow can clip it.
      await expect(page.locator('body > [role="dialog"]')).toHaveCount(1);
      await expect(dialog.getByRole('status')).toBeInViewport();
      // Follows the field when the page scrolls.
      await page.mouse.wheel(0, 150);
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      );
      await expectInViewport(page, dialog);
    });

    test('en una ventana baja el calendario se desplaza por dentro', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 330 });
      await loginAndWait(page, 'boss');
      await page.goto('/admin/reportes');
      await page.getByLabel('Desde').click();
      const dialog = page.getByRole('dialog');
      await expectInViewport(page, dialog);
      await expect(dialog.getByRole('status')).toBeInViewport();
      const scrolls = await dialog.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      );
      expect(scrolls).toBe(true);
      // The inner scroll must stick (placement must not reset it).
      await dialog.evaluate((element) => {
        element.scrollTop = 100;
      });
      await page.waitForTimeout(300);
      const kept = await dialog.evaluate((element) => element.scrollTop);
      expect(kept).toBeGreaterThan(0);
    });

    test('en una ventana baja el selector de horario conserva su scroll', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 800, height: 230 });
      await loginAndWait(page, 'boss');
      await page.goto('/admin/historial');
      await page
        .getByRole('region', { name: 'Filtros' })
        .getByLabel('Horario')
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const info = await dialog.evaluate((element) => {
        const scrollable = [
          element,
          ...Array.from(element.querySelectorAll<HTMLElement>('*')),
        ].filter((node) => node.scrollHeight > node.clientHeight + 1);
        const target = scrollable[scrollable.length - 1] ?? element;
        target.scrollTop = 60;
        return scrollable.length;
      });
      expect(info).toBeGreaterThan(0);
      await page.waitForTimeout(300);
      const kept = await dialog.evaluate((element) =>
        [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))]
          .map((node) => node.scrollTop)
          .reduce((a, b) => Math.max(a, b), 0),
      );
      expect(kept).toBeGreaterThan(0);
    });

    test('el calendario usa dos columnas en ancho y una en móvil', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await loginAndWait(page, 'boss');
      await page.goto('/admin/reportes');
      await page.getByLabel('Desde').click();
      const wide = await page.getByRole('dialog').boundingBox();
      const end = await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Hasta/ })
        .boundingBox();
      const grid = await page
        .getByRole('dialog')
        .getByRole('grid')
        .boundingBox();
      expect(end!.x).toBeGreaterThanOrEqual(grid!.x + grid!.width);
      expect(wide!.height).toBeLessThan(420);
      await page.keyboard.press('Escape');

      await page.setViewportSize({ width: 390, height: 500 });
      await page.getByLabel('Desde').click();
      const dialog = page.getByRole('dialog');
      await expectInViewport(page, dialog);
      await expect(dialog.getByRole('status')).toBeInViewport();
      const narrow = await dialog
        .getByRole('button', { name: /^Hasta/ })
        .boundingBox();
      const narrowGrid = await dialog.getByRole('grid').boundingBox();
      expect(narrow!.y).toBeGreaterThanOrEqual(
        narrowGrid!.y + narrowGrid!.height,
      );
    });

    test('Historial: el selector de horario queda dentro de la ventana', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 800, height: 420 });
      await loginAndWait(page, 'boss');
      await page.goto('/admin/historial');
      const field = page
        .getByRole('region', { name: 'Filtros' })
        .getByLabel('Horario');
      await liftToBottom(page, field, 70);
      await field.click();
      const dialog = page.getByRole('dialog');
      await expectInViewport(page, dialog);
      await expect(
        dialog.getByRole('listbox', { name: 'Día de la semana' }),
      ).toBeVisible();
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
    const newPeriod = page.getByRole('dialog', { name: 'Nuevo periodo' });
    await newPeriod.getByLabel('Nombre').fill('2026-S');
    await newPeriod.getByLabel('Primer día').click();
    await pickDay(page, '2026-11-02');
    await pickDay(page, '2026-12-04');
    // Only the last day changes; the first one is kept.
    await newPeriod.getByLabel('Último día').click();
    await pickDay(page, '2026-12-05');
    await expect(newPeriod.getByLabel('Primer día')).toContainText(
      '2 nov 2026',
    );
    await expect(newPeriod.getByLabel('Último día')).toContainText(
      '5 dic 2026',
    );
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
