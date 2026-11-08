import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, control, loginAndWait } from './support';

/**
 * H10: reports against the simulated semester (`/control/semester`). The
 * figures are those of `server/src/reports/seed/semester.expected.json`.
 * Set REPORT_SHOTS to a folder to also save review screenshots (desktop and
 * mobile); nothing is written to the repository.
 */
const SHOTS = process.env.REPORT_SHOTS;

test.describe('reportes del administrador (H10)', () => {
  test.beforeEach(async ({ request }) => {
    await control(request, 'semester');
  });

  test('summary, charts with a peak and tooltip, filters and CSV export', async ({
    page,
  }) => {
    await loginAndWait(page, 'boss');
    await expect(
      page.getByRole('region', { name: 'Requiere atención' }),
    ).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Secciones' })
      .getByRole('link', { name: 'Reportes' })
      .click();
    await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();

    // Afluencia: the busiest hour is 06:00 with 176 entries.
    const hours = page.getByRole('region', { name: 'Entradas por hora' });
    await expect(hours).toBeVisible();
    await expect(
      hours.getByRole('img', { name: /pico en 06:00 con 176/ }),
    ).toBeVisible();
    // The peak is the accent bar: the first one is 06:00.
    await hours
      .locator('.recharts-bar-rectangle')
      .filter({ has: page.locator('[fill="var(--accent)"]') })
      .first()
      .hover();
    await expect(hours.getByRole('status')).toContainText('176 entradas');
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: join(SHOTS, 'reportes-afluencia.png'),
        fullPage: true,
      });
    }

    // Asistencia by schedule: Lunes 06:00 = 58 of 94 (expected.json).
    await page.getByRole('tab', { name: 'Asistencia' }).click();
    await page.getByLabel('Agrupar').selectOption('schedule');
    const row = page.getByRole('row', { name: /Lunes 06:00/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('94');
    await expect(row).toContainText('58');
    await expect(page).toHaveURL(/reporte=asistencia/);
    await expect(page).toHaveURL(/agrupar=schedule/);

    // Export: BOM, ';' separator, named after the report and range.
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    await expect(page.getByText(/datos personales/)).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar el archivo' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      /^reporte-attendance-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const path = await download.path();
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(text).toContain(';');
    expect(text).toContain('Lunes 06:00');
  });

  test('the assistant does not reach the reports', async ({ page }) => {
    await loginAndWait(page, 'ana');
    await expect(
      page
        .getByRole('navigation', { name: 'Secciones' })
        .getByRole('link', { name: 'Reportes' }),
    ).toHaveCount(0);
    await page.goto('/admin/reportes');
    await expect(page.getByText('Sin permiso')).toBeVisible();
  });

  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['mobile', { width: 390, height: 844 }],
  ] as const) {
    test(`review screenshots (${name})`, async ({ page }) => {
      test.skip(!SHOTS, 'set REPORT_SHOTS to save them');
      mkdirSync(SHOTS!, { recursive: true });
      await page.setViewportSize(viewport);
      await page.goto('/login');
      await page.screenshot({ path: join(SHOTS!, `${name}-login.png`) });
      await loginAndWait(page, 'boss');
      await page.screenshot({
        path: join(SHOTS!, `${name}-resumen.png`),
        fullPage: true,
      });
      await page.goto('/ahora');
      await page.screenshot({
        path: join(SHOTS!, `${name}-ahora.png`),
        fullPage: true,
      });
      await page.goto('/admin/estudiantes');
      await page.screenshot({
        path: join(SHOTS!, `${name}-admin.png`),
        fullPage: true,
      });
      await page.goto('/admin/reportes');
      await expect(
        page.getByRole('region', { name: 'Entradas por hora' }),
      ).toBeVisible();
      await page.screenshot({
        path: join(SHOTS!, `${name}-reportes.png`),
        fullPage: true,
      });
    });
  }
});
