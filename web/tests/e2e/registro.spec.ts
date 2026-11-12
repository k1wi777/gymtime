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

    // Nothing can be sent until a student is chosen.
    await expect(
      page.getByRole('button', { name: 'Registrar entrada', exact: true }),
    ).toBeDisabled();
    await expect(page.getByText('Elija primero un estudiante.')).toBeVisible();

    await page.getByRole('combobox').fill('1002');
    await page.getByRole('option', { name: /Beto Ruiz/ }).click();
    await expect(page.getByText('Estudiante seleccionado')).toBeVisible();
    await page.getByLabel(/Motivo/).fill('El lector no reconoce la huella');
    await page
      .getByRole('button', { name: 'Registrar entrada de Beto' })
      .click();

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
    // The confirmation closes by itself (R12).
    await expect(
      page.getByText(/Entrada registrada para Beto Ruiz/),
    ).toBeHidden({ timeout: 10_000 });

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
