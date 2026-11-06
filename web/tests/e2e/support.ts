import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

export const CONTROL = 'http://127.0.0.1:3002';
export const PASSWORD = 'Clave-de-prueba-1';

export interface World {
  students: Record<string, { id: string; document: string; name: string }>;
  scheduleId: string;
  laterScheduleId: string;
}

export async function control<T = unknown>(
  request: APIRequestContext,
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const response = await request.post(`${CONTROL}/control/${path}`, {
    data: body,
  });
  expect(response.ok(), `control ${path}`).toBe(true);
  return (await response.json()) as T;
}

/** Every test starts from the same fresh world (10:00 of 2026-11-02, Grupo A running). */
export const test = base.extend<{ world: World }>({
  world: async ({ request }, use) => {
    await use(await control<World>(request, 'reset'));
  },
});

export async function login(page: Page, username = 'ana', password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function loginAndWait(page: Page, username = 'ana') {
  await login(page, username);
  // The administrator lands on the summary (H10, R21); the assistant on "Ahora".
  const [url, heading] =
    username === 'boss'
      ? [/\/admin\/resumen$/, 'Resumen']
      : [/\/ahora$/, 'Ahora'];
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  // The live link is part of every screen: wait for it before driving the reader.
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
}

export const expectPerson = (page: Page, section: string, name: string) =>
  expect(
    page.getByRole('region', { name: section, exact: true }).getByText(name),
  );

export { expect };
