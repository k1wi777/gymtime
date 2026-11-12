import { control, expect, loginAndWait, test } from './support';

test.describe('alarma y mensajes (R7)', () => {
  test('the banner appears everywhere and turning it off asks for confirmation', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await control(request, 'scan', { document: '1001' });
    await page.getByRole('link', { name: 'Alarma y mensajes' }).click();

    await page.getByRole('button', { name: 'Encender alarma' }).click();
    const banner = page
      .getByRole('alert')
      .filter({ hasText: 'ALARMA SONANDO' });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(/1 persona sigue dentro/)).toBeVisible();

    // The banner follows the user to other screens.
    await page.getByRole('link', { name: 'Ahora' }).click();
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'Apagar alarma' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/no registrada/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'Apagar alarma' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Apagar alarma' })
      .click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByText(/cerr/i).first()).toBeVisible();
  });

  test('the test beep shows the banner for a few seconds, hides it by itself and the card goes off (R17)', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await page.getByRole('link', { name: 'Alarma y mensajes' }).click();
    await page.getByRole('button', { name: 'Probar alarma' }).click();
    const banner = page
      .getByRole('alert')
      .filter({ hasText: 'ALARMA SONANDO' });
    await expect(banner).toBeVisible();
    // The server clock is manual in this world: let the 5 s beep run out.
    await control(request, 'clock', { time: '10:00:30' });
    await expect(banner).toBeHidden({ timeout: 12_000 });
    await expect(
      page.getByRole('button', { name: 'Encender alarma' }),
    ).toBeEnabled();
    await expect(page.getByText('Apagada').first()).toBeVisible();
  });

  test('sends a message to the reader and lists the order', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await page.getByRole('link', { name: 'Alarma y mensajes' }).click();

    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /línea|Escriba/i })
        .first(),
    ).toBeVisible();

    await page.getByLabel(/Línea 1/).fill('Hola equipo');
    await page.getByLabel(/Línea 2/).fill('Cierre 11:00');
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(
      page.getByText('Mensaje mostrado en el lector.'),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Órdenes recientes' }).getByRole('row'),
    ).not.toHaveCount(1);
  });

  test('a message to an offline reader says it is queued', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await control(request, 'device', { online: false });
    await loginAndWait(page);
    await page.getByRole('link', { name: 'Alarma y mensajes' }).click();
    await page.getByLabel(/Línea 1/).fill('Hola');
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(
      page.getByText(/El lector está fuera de línea: el mensaje se mostrará/),
    ).toBeVisible();
  });
});
