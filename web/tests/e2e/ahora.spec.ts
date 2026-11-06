import { control, expect, loginAndWait, test } from './support';

const region = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('region', { name, exact: true });

test.describe('«Ahora» en vivo (R1, R2, R3)', () => {
  test('a scan on the reader moves the person without reloading the page', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await expect(region(page, 'Faltan').getByText('Ana Gómez')).toBeVisible();
    await expect(
      region(page, 'Faltan').getByText('Diego Sin Huella'),
    ).toHaveCount(0);

    // Marks the document: anything that survives a reload would reveal it.
    await page.evaluate(
      () => ((window as unknown as Record<string, unknown>).__noReload = true),
    );

    await control(request, 'scan', { document: '1001' });
    await expect(region(page, 'Dentro').getByText('Ana Gómez')).toBeVisible();
    await expect(region(page, 'Faltan').getByText('Ana Gómez')).toHaveCount(0);
    await expect(
      region(page, 'Últimos escaneos').getByText('Ana Gómez'),
    ).toBeVisible();

    await control(request, 'scan', { document: '1001' });
    await expect(region(page, 'Salieron').getByText('Ana Gómez')).toBeVisible();
    await expect(region(page, 'Dentro').getByText('Ana Gómez')).toHaveCount(0);

    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__noReload,
      ),
    ).toBe(true);
  });

  test('shows the schedule times in Bogotá even if the browser is elsewhere', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await expect(
      page
        .getByText('9:00 a. m. – 11:00 a. m.')
        .or(page.getByText(/09:00\s*–\s*11:00/))
        .first(),
    ).toBeVisible();
  });

  test('leaves «Conectado» when the API drops and recovers by itself', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    const restart = control(request, 'api-restart', { downMs: 6000 });
    await expect(page.getByText(/^(Reconectando…|Desconectado)$/)).toBeVisible({
      timeout: 20_000,
    });
    await restart;
    await expect(page.getByText('Conectado', { exact: true })).toBeVisible({
      timeout: 40_000,
    });
    // After the resync the screen is coherent with the server again.
    await control(request, 'scan', { document: '1002' });
    await expect(region(page, 'Dentro').getByText('Beto Ruiz')).toBeVisible();
  });
});
