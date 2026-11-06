import { vi } from 'vitest';

/** State and spies of the mocked `next/navigation`, shared by every test. */
export const nav = {
  pathname: '/ahora',
  search: '',
  replace: vi.fn(),
  push: vi.fn(),
};

export const resetNav = (): void => {
  nav.pathname = '/ahora';
  nav.search = '';
  nav.replace.mockReset();
  nav.push.mockReset();
};

// Stable between renders, like the real router.
const router = {
  replace: nav.replace,
  push: nav.push,
  refresh: vi.fn(),
  back: vi.fn(),
};
export const useRouter = () => router;
export const usePathname = () => nav.pathname;
export const useSearchParams = () => new URLSearchParams(nav.search);
export const redirect = vi.fn();
