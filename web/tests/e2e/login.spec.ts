import {
  control,
  expect,
  login,
  loginAndWait,
  PASSWORD,
  test,
} from './support';

test.describe('login (R8, R9, R10)', () => {
  test('signs in, lands on «Ahora» and stores nothing in the browser', async ({
    page,
    context,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await expect(page.getByText('Grupo A')).toBeVisible();
    await expect(page.getByText('Ana Asistente')).toBeVisible();

    const menu = page.getByRole('navigation', { name: 'Secciones' });
    await expect(menu.getByRole('link')).toHaveText([
      'Ahora',
      'Registro manual',
      'Enrolar huella',
      'Alarma y mensajes',
      'Dispositivo',
      'Horarios',
    ]);

    // The session lives in an httpOnly cookie; nothing in web storage.
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'gt_session');
    expect(session?.httpOnly).toBe(true);
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      readable: document.cookie,
    }));
    expect(stored).toEqual({ local: [], session: [], readable: '' });
  });

  test('shows a generic message for wrong credentials', async ({
    page,
    world,
  }) => {
    void world;
    await login(page, 'ana', 'otra-clave-distinta');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Usuario' }),
    ).toHaveText(
      'Usuario o contraseña incorrectos, o la cuenta está bloqueada.',
    );
    await login(page, 'nadie', 'otra-clave-distinta');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Usuario' }),
    ).toHaveText(
      'Usuario o contraseña incorrectos, o la cuenta está bloqueada.',
    );
    await expect(page).toHaveURL(/\/login/);
  });

  test('a visitor without cookie is sent to the login and returns where they were going', async ({
    page,
    world,
  }) => {
    void world;
    await page.goto('/horarios');
    await expect(page).toHaveURL(/\/login\?next=%2Fhorarios/);
    await page.getByLabel('Usuario').fill('ana');
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/horarios$/);
    await expect(page.getByRole('heading', { name: 'Horarios' })).toBeVisible();
  });

  test('forces the password change on the first sign-in', async ({
    page,
    world,
  }) => {
    void world;
    await login(page, 'nueva');
    await expect(page).toHaveURL(/\/cambiar-contrasena$/);
    await expect(page.getByText(/debe elegir una nueva/)).toBeVisible();

    await page.getByLabel('Contraseña actual').fill(PASSWORD);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill('corta');
    await page.getByLabel('Repita la nueva contraseña').fill('otra');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText(/al menos 10 caracteres/)).toBeVisible();
    await expect(page.getByText('Las contraseñas no coinciden.')).toBeVisible();

    await page
      .getByLabel('Nueva contraseña', { exact: true })
      .fill('una-clave-nueva-1');
    await page
      .getByLabel('Repita la nueva contraseña')
      .fill('una-clave-nueva-1');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page).toHaveURL(/\/ahora$/);
    await expect(page.getByRole('heading', { name: 'Ahora' })).toBeVisible();
  });

  test('cannot skip the forced change by opening other pages', async ({
    page,
    world,
  }) => {
    void world;
    await login(page, 'nueva');
    await expect(page).toHaveURL(/\/cambiar-contrasena$/);
    await page.goto('/ahora');
    await expect(page).toHaveURL(/\/cambiar-contrasena$/);
  });

  test('an expired session leads to the login with its notice', async ({
    page,
    request,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    // 45 minutes later the 30-minute idle limit has passed on the server.
    await control(request, 'clock', { time: '10:45' });
    await page.getByRole('link', { name: 'Dispositivo' }).click();
    await expect(page).toHaveURL(/\/login\?aviso=expirada/);
    await expect(
      page.getByText('Su sesión expiró. Inicie sesión de nuevo.'),
    ).toBeVisible();
    await page.getByLabel('Usuario').fill('ana');
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/(ahora|dispositivo)$/);
  });

  test('signs out and the panel is closed again', async ({ page, world }) => {
    void world;
    await loginAndWait(page);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login\?aviso=cerrada/);
    await expect(page.getByText('Cerró sesión correctamente.')).toBeVisible();
    await page.goto('/ahora');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows a permissions notice when the API says 403', async ({
    page,
    world,
  }) => {
    void world;
    await loginAndWait(page);
    await page.route('**/devices/status', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': 'http://localhost:3000',
          'access-control-allow-credentials': 'true',
        },
        body: JSON.stringify({
          statusCode: 403,
          code: 'FORBIDDEN_ROLE',
          message: 'x',
        }),
      }),
    );
    await page.getByRole('link', { name: 'Dispositivo' }).click();
    await expect(
      page.getByText('Su rol no permite esta operación.').first(),
    ).toBeVisible();
  });
});
