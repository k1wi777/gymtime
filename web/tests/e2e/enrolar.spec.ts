import { control, expect, loginAndWait, test } from './support';

async function choose(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('link', { name: 'Enrolar huella' }).click();
  await expect(
    page.getByRole('heading', { name: 'Enrolar huella' }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Elegir a ${name}` }).click();
}

test.describe('enrolar huella (R5, R6)', () => {
  test('is blocked without consent until it is registered with confirmation', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await choose(page, 'Eva Sin Consentimiento');
    const start = page.getByRole('button', { name: 'Iniciar enrolamiento' });
    await expect(page.getByText('Falta el consentimiento')).toBeVisible();
    await expect(start).toBeDisabled();

    await page
      .getByRole('button', { name: /Registrar consentimiento…/ })
      .click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', {
      name: 'Registrar consentimiento',
    });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Falta el consentimiento')).toHaveCount(0);
    await expect(start).toBeEnabled();
  });

  test('follows the steps live until the fingerprint is registered', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await control(request, 'enroll', { stepMs: 700 });
    await loginAndWait(page);
    await choose(page, 'Diego Sin Huella');
    await page.getByRole('button', { name: 'Iniciar enrolamiento' }).click();

    const step = page.getByTestId('enroll-step');
    const seen = new Set<string>();
    await expect
      .poll(
        async () => {
          const text =
            (await step.textContent({ timeout: 500 }).catch(() => null)) ?? '';
          if (text) seen.add(text);
          return seen.size;
        },
        { timeout: 20_000, intervals: [150] },
      )
      .toBeGreaterThanOrEqual(2);
    await expect(
      page.getByRole('status').getByText('Huella registrada'),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Listo' }).click();
    await page
      .getByRole('button', { name: 'Elegir a Diego Sin Huella' })
      .click();
    await expect(page.getByText(/ya tiene una huella/)).toBeVisible();
  });

  test('shows the reason when the reader fails', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await control(request, 'enroll', { mode: 'fail', stepMs: 100 });
    await loginAndWait(page);
    await choose(page, 'Diego Sin Huella');
    await page.getByRole('button', { name: 'Iniciar enrolamiento' }).click();
    await expect(page.getByText('El enrolamiento falló')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole('button', { name: 'Intentar de nuevo' }),
    ).toBeVisible();
  });

  test('can be cancelled while running', async ({ page, request, world }) => {
    void world;
    await control(request, 'enroll', { stepMs: 2000 });
    await loginAndWait(page);
    await choose(page, 'Diego Sin Huella');
    await page.getByRole('button', { name: 'Iniciar enrolamiento' }).click();
    await expect(page.getByTestId('enroll-step')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar enrolamiento' }).click();
    await expect(page.getByText('Enrolamiento cancelado')).toBeVisible();
  });
});
