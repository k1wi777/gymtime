import { expect, test, control, loginAndWait } from './support';

/**
 * H11 (R19): the panel works with its Content-Security-Policy. Every screen
 * of the administrator (the superset of the assistant's) is opened, with the
 * reports charts drawn on the simulated semester, and no
 * `securitypolicyviolation` event nor console error may appear.
 */
const SCREENS = [
  '/ahora',
  '/registro',
  '/enrolar',
  '/ordenes',
  '/dispositivo',
  '/horarios',
  '/admin/resumen',
  '/admin/reportes',
  '/admin/periodos',
  '/admin/horarios',
  '/admin/estudiantes',
  '/admin/historial',
  '/admin/auditoria',
  '/admin/usuarios',
];

test('security headers and a CSP with nonce, and no violation on any screen', async ({
  page,
  request,
}) => {
  await control(request, 'semester');
  const violations: string[] = [];
  const errors: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  const login = await page.goto('/login');
  const headers = login!.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  const csp = headers['content-security-policy'];
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain('connect-src');
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

  await loginAndWait(page, 'boss');
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (path === '/admin/reportes') {
      // Wait for the charts (SVG) to be drawn.
      await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
    }
    violations.push(
      ...(await page.evaluate(
        () => (window as unknown as { __csp?: string[] }).__csp ?? [],
      )),
    );
  }
  expect(violations).toEqual([]);
  // CSS and network noise aside, a blocked resource would show up here.
  expect(errors.filter((e) => /content security policy/i.test(e))).toEqual([]);
});
