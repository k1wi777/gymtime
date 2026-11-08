import type { Locator, Page } from '@playwright/test';
import { expect, loginAndWait, pickDay, popover, test } from './support';

const SHOTS = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function openMenu(page: Page, link: string) {
  await page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('link', { name: link })
    .click();
}

/** Opens a «Más» menu once the page stopped scrolling (a scroll closes it). */
async function openMore(page: Page, button: Locator) {
  await button.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await button.click();
}

/** Where the focus is: inside the given dialog? */
const focusInside = (dialog: Locator) =>
  dialog.evaluate((node) => node.contains(document.activeElement));

async function createPeriod(page: Page) {
  await openMenu(page, 'Periodos');
  await page.getByRole('button', { name: 'Nuevo periodo' }).click();
  const modal = page.getByRole('dialog', { name: 'Nuevo periodo' });
  await modal.getByLabel('Nombre').fill('2026-2');
  await modal.getByLabel('Primer día').click();
  await pickDay(page, '2026-11-02');
  await pickDay(page, '2026-12-04');
  await modal.getByRole('button', { name: 'Crear periodo' }).click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Periodo 2026-2' }),
  ).toBeVisible();
}

async function createSchedule(
  page: Page,
  name: string,
  weekday: string,
  start: string,
  end: string,
) {
  await page.getByRole('button', { name: 'Nuevo horario' }).click();
  const modal = page.getByRole('dialog', { name: 'Nuevo horario' });
  await modal.getByLabel('Nombre').fill(name);
  await modal.getByLabel('Día de la semana').selectOption(weekday);
  await modal.getByLabel('Inicio').fill(start);
  await modal.getByLabel('Fin').fill(end);
  await modal.getByRole('button', { name: 'Crear horario' }).click();
  await expect(modal).toHaveCount(0);
}

test.describe('modales y filtro por día', () => {
  test('foco atrapado, Escape, fondo y aviso de cambios sin guardar', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'boss');
    await openMenu(page, 'Periodos');
    const opener = page.getByRole('button', { name: 'Nuevo periodo' });
    await opener.click();
    const modal = page.getByRole('dialog', { name: 'Nuevo periodo' });
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal.getByLabel('Nombre')).toBeFocused();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await shot(page, 'modal-periodo');

    // Tab never leaves the modal, forwards or backwards.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusInside(modal)).toBe(true);
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusInside(modal)).toBe(true);
    }

    // No changes: Escape closes and the focus goes back to the button.
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

    // With changes: Escape and the backdrop ask first.
    await opener.click();
    await modal.getByLabel('Nombre').fill('2027-1');
    await page.keyboard.press('Escape');
    const ask = page.getByRole('dialog', { name: '¿Descartar los cambios?' });
    await expect(ask).toBeVisible();
    await shot(page, 'aviso-cambios');
    await ask.getByRole('button', { name: 'Seguir editando' }).click();
    await expect(modal.getByLabel('Nombre')).toHaveValue('2027-1');
    await page.mouse.click(5, 5);
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Descartar cambios' }).click();
    await expect(modal).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('editar un estudiante abre una modal con foco y Escape devuelve el foco', async ({
    page,
    world,
  }) => {
    const student = Object.values(world.students)[0]!;
    await loginAndWait(page, 'boss');
    await openMenu(page, 'Estudiantes');
    const opener = page.getByRole('button', {
      name: `Editar a ${student.name}`,
    });
    await opener.click();
    const modal = page.getByRole('dialog', { name: `Editar ${student.name}` });
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('Nombre *')).toHaveValue(student.name);
    expect(await focusInside(modal)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('editar un usuario abre una modal con foco y Escape devuelve el foco', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'boss');
    await openMenu(page, 'Usuarios');
    const opener = page.getByRole('button', { name: 'Editar a Ana Asistente' });
    await opener.click();
    const modal = page.getByRole('dialog', { name: 'Editar Ana Asistente' });
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('Nombre')).toHaveValue('Ana Asistente');
    expect(await focusInside(modal)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('un selector abierto en la modal queda por encima y Escape lo cierra primero', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'boss');
    await createPeriod(page);
    await openMenu(page, 'Gestión de horarios');
    await createSchedule(page, 'Lunes mañana', '1', '06:00', '07:00');
    await createSchedule(page, 'Lunes tarde', '1', '18:00', '19:00');

    await page.setViewportSize({ width: 1100, height: 430 });
    const studentsButton = page
      .getByRole('region', { name: 'Horario Lunes mañana' })
      .getByRole('button', { name: 'Estudiantes' });
    await studentsButton.scrollIntoViewIfNeeded();
    const pageScroll = await page.evaluate(() => window.scrollY);
    await studentsButton.click();
    const modal = page.getByRole('dialog', {
      name: 'Estudiantes de Lunes mañana',
    });
    await expect(modal).toBeVisible();
    const body = modal.locator('xpath=./div[1]');

    // The modal body scrolls inside; the page behind does not.
    const scrolls = await body.evaluate((node) => ({
      overflows: node.scrollHeight > node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(scrolls).toEqual({ overflows: true, overflowY: 'auto' });
    await body.evaluate((node) => {
      node.scrollTop = 120;
    });
    const kept = await body.evaluate((node) => node.scrollTop);
    expect(kept).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);

    // Date popover: above the modal, whole in the viewport, Escape closes it only.
    await modal.getByLabel('Desde (opcional)').click();
    const panel = popover(page);
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const size = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    const onTop = await page.evaluate(
      ([x, y]) =>
        !!document
          .elementFromPoint(x!, y!)
          ?.closest('body > [role="dialog"][data-side]'),
      [box.x + box.width / 2, box.y + 20],
    );
    expect(onTop).toBe(true);
    await shot(page, 'popover-fecha-sobre-modal');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('Desde (opcional)')).toBeFocused();
    expect(await body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

    // Schedule popover: a click inside the modal (outside it) closes only it.
    await modal.getByLabel('Copiar estudiantes de otro horario').click();
    const list = popover(page);
    await expect(list).toBeVisible();
    await shot(page, 'popover-horario-sobre-modal');
    const listBox = (await list.boundingBox())!;
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(size.height);
    await modal
      .getByRole('heading', { name: 'Estudiantes de Lunes mañana' })
      .click();
    await expect(list).toHaveCount(0);
    await expect(modal).toBeVisible();
    expect(await body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

    // A second Escape closes the modal and the focus returns to the button.
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(studentsButton).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  });

  test('en pantalla estrecha la modal ocupa todo y se desplaza con el pie visible', async ({
    page,
    world,
  }) => {
    void world;
    await page.setViewportSize({ width: 360, height: 420 });
    await loginAndWait(page, 'boss');
    await page.goto('/admin/periodos');
    await page.getByRole('button', { name: 'Nuevo periodo' }).click();
    const modal = page.getByRole('dialog', { name: 'Nuevo periodo' });
    await expect(modal).toBeVisible();
    const box = (await modal.boundingBox())!;
    expect(box).toMatchObject({ x: 0, y: 0, width: 360, height: 420 });
    await expect(
      modal.getByRole('button', { name: 'Crear periodo' }),
    ).toBeInViewport();
    await shot(page, 'modal-movil');
  });

  test('filtro por día: pastillas, Todos con vista semanal y vuelta al primer día', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page, 'boss');
    await createPeriod(page);
    await openMenu(page, 'Gestión de horarios');
    await createSchedule(page, 'Lunes mañana', '1', '06:00', '07:00');
    await createSchedule(page, 'Lunes tarde', '1', '18:00', '19:00');
    await createSchedule(page, 'Miércoles', '3', '07:00', '08:00');

    const group = page.getByRole('radiogroup', { name: 'Día' });
    await expect(group.getByRole('radio')).toHaveText([
      /Lunes\s*Lun\s*2/,
      /Miércoles\s*Mié\s*1/,
      /Todos\s*3/,
    ]);
    await expect(group.getByRole('radio', { name: /Lunes/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The pills sit under the period selector, not next to it.
    const period = (await page.getByLabel('Periodo').boundingBox())!;
    const pills = (await group.boundingBox())!;
    expect(pills.y).toBeGreaterThan(period.y + period.height - 1);
    await expect(page.getByRole('region', { name: /^Horario / })).toHaveCount(
      2,
    );
    await shot(page, 'pastillas-lunes');

    await group.getByRole('radio', { name: /Miércoles/ }).click();
    await expect(page.getByRole('region', { name: /^Horario / })).toHaveCount(
      1,
    );

    await group.getByRole('radio', { name: /Todos/ }).click();
    await expect(page.getByRole('region', { name: /^Horario / })).toHaveCount(
      0,
    );
    const week = page.getByRole('region', { name: 'Vista semanal' });
    await expect(week).toHaveCount(1);
    await expect(
      week.getByRole('button', { name: /Anterior|Siguiente/ }),
    ).toHaveCount(0);
    await expect(week.getByText(/Semana del/)).toHaveCount(0);
    await expect(week.getByText(/estudiantes$/)).toHaveCount(0);
    await week.scrollIntoViewIfNeeded();
    await week
      .getByRole('button', { name: 'Más acciones de miércoles 07:00–08:00' })
      .scrollIntoViewIfNeeded();
    await shot(page, 'vista-semanal-todos');

    // «Más» on a slot: Editar opens the modal; Escape returns to the button.
    const more = week.getByRole('button', {
      name: 'Más acciones de miércoles 07:00–08:00',
    });
    await openMore(page, more);
    await page.getByRole('menuitem', { name: 'Editar' }).click();
    const edit = page.getByRole('dialog', { name: 'Editar Miércoles' });
    await expect(edit.getByLabel('Nombre')).toHaveValue('Miércoles');
    await page.keyboard.press('Escape');
    await expect(edit).toHaveCount(0);
    await expect(more).toBeFocused();

    // Deleting the only Wednesday schedule leaves «Todos» active.
    await openMore(page, more);
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    await page
      .getByRole('dialog', { name: 'Eliminar horario' })
      .getByRole('button', { name: 'Eliminar' })
      .click();
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByRole('radio', { name: /Todos/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Back on a day.
    await group.getByRole('radio', { name: /Lunes/ }).click();
    await expect(page.getByRole('region', { name: /^Horario / })).toHaveCount(
      2,
    );
  });
});
