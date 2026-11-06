import { expect, loginAndWait, test } from './support';

test.describe('registro manual (R4)', () => {
  test('registers an entry with a reason, after confirming, and shows it in «Ahora»', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await page.getByRole('link', { name: 'Registro manual' }).click();
    await expect(
      page.getByRole('heading', { name: 'Registro manual' }),
    ).toBeVisible();

    await page.getByRole('button', { name: /Registrar entrada/ }).click();
    await expect(
      page
        .getByText('Elija a un estudiante.')
        .or(page.getByRole('alert').filter({ hasText: /estudiante/i }))
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByText(/motivo/i)
        .and(page.getByRole('alert'))
        .first(),
    ).toBeVisible();

    await page.getByPlaceholder('Buscar por nombre o documento').fill('1002');
    await page
      .getByLabel('Estudiante: resultados')
      .selectOption({ label: 'Beto Ruiz · 1002' });
    await page.getByLabel('Motivo').fill('El lector no reconoce la huella');
    await page.getByRole('button', { name: /Registrar entrada/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Beto Ruiz')).toBeVisible();
    await expect(
      dialog.getByText('Motivo: El lector no reconoce la huella'),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Registrar', exact: true })
      .click();

    await expect(
      page.getByText(/Entrada registrada para Beto Ruiz/),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Ahora' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Dentro', exact: true })
        .getByText('Beto Ruiz'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Dentro', exact: true })
        .getByText('Manual'),
    ).toBeVisible();
  });
});
