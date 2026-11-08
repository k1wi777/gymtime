import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

export const CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? '3002'}`;
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
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
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

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** In the open calendar, goes to the month of `day` (`YYYY-MM-DD`). */
export async function showMonth(page: Page, day: string) {
  const dialog = page.getByRole('dialog');
  const [year, month] = day.split('-').map(Number) as [number, number];
  const wanted = year * 12 + month - 1;
  for (let step = 0; step < 120; step += 1) {
    const shown = (await dialog.getByRole('grid').getAttribute('aria-label'))!;
    const [name, , shownYear] = shown.split(' ') as [string, string, string];
    const at = Number(shownYear) * 12 + MONTHS.indexOf(name);
    if (at === wanted) break;
    await dialog
      .getByRole('button', {
        name: at < wanted ? 'Mes siguiente' : 'Mes anterior',
      })
      .click();
  }
}

/** The day button of the open calendar. */
export const dayButton = (page: Page, day: string) => {
  const [year, month, date] = day.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return page.getByRole('dialog').getByRole('button', {
    name: new RegExp(`^\\S+ ${date} de ${MONTHS[month - 1]} de ${year}`),
  });
};

/** In the open calendar, goes to the month of `day` and clicks it. */
export async function pickDay(page: Page, day: string) {
  await showMonth(page, day);
  await dayButton(page, day).click();
}

export { expect };
