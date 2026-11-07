import { docsEnabled } from './swagger.js';

describe('docsEnabled', () => {
  it('publishes the docs outside production', () => {
    expect(docsEnabled({ NODE_ENV: 'development', ENABLE_DOCS: false })).toBe(
      true,
    );
  });
  it('hides them in production unless ENABLE_DOCS is on', () => {
    expect(docsEnabled({ NODE_ENV: 'production', ENABLE_DOCS: false })).toBe(
      false,
    );
    expect(docsEnabled({ NODE_ENV: 'production', ENABLE_DOCS: true })).toBe(
      true,
    );
  });
});
