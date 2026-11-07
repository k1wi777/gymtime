import { productionWarnings } from './production-warnings.js';

const base = {
  NODE_ENV: 'production' as const,
  TRUST_PROXY: 1,
  COOKIE_DOMAIN: '.example.edu',
  CORS_ORIGINS: ['https://app.example.edu'],
  DEVICE_TOKEN: undefined,
};

describe('productionWarnings', () => {
  it('is silent in development', () => {
    expect(
      productionWarnings({ ...base, NODE_ENV: 'development', TRUST_PROXY: 0 }),
    ).toEqual([]);
  });

  it('is silent for a complete production configuration', () => {
    expect(productionWarnings(base)).toEqual([]);
  });

  it('warns about each suspicious setting without echoing values', () => {
    const warnings = productionWarnings({
      ...base,
      TRUST_PROXY: 0,
      COOKIE_DOMAIN: undefined,
      CORS_ORIGINS: [],
      DEVICE_TOKEN: 'secret-shared-token-123',
    });
    expect(warnings).toHaveLength(4);
    expect(warnings.join(' ')).not.toContain('secret-shared-token-123');
  });
});
