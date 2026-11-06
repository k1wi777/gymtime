import { checkCsrf, isMutation } from './csrf.js';

const ALLOWED = ['http://localhost:3000', 'https://panel.example.org'];
const req = (method: string, headers: Record<string, string> = {}) =>
  ({ method, headers }) as never;

describe('checkCsrf (R18)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('does not protect %s', (method) => {
    expect(isMutation(method)).toBe(false);
    expect(checkCsrf(req(method), ALLOWED)).toBeNull();
  });

  describe.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s', (method) => {
    const ok = {
      'x-gymtime-client': 'panel',
      origin: 'http://localhost:3000',
    };

    it('passes with the header and a listed origin', () => {
      expect(checkCsrf(req(method, ok), ALLOWED)).toBeNull();
      expect(
        checkCsrf(
          req(method, { ...ok, origin: 'https://panel.example.org' }),
          ALLOWED,
        ),
      ).toBeNull();
    });

    it('fails without the client header or with another value', () => {
      expect(checkCsrf(req(method, { origin: ok.origin }), ALLOWED)).toBe(
        'missing_client_header',
      );
      expect(
        checkCsrf(req(method, { ...ok, 'x-gymtime-client': 'curl' }), ALLOWED),
      ).toBe('missing_client_header');
    });

    it.each([
      undefined,
      'null',
      'http://evil.example',
      'http://localhost:3000/',
      'http://localhost:3001',
      'https://localhost:3000',
      'http://localhost.evil.example:3000',
    ])('fails with the origin %s', (origin) => {
      const headers: Record<string, string> = {
        'x-gymtime-client': 'panel',
        ...(origin === undefined ? {} : { origin }),
      };
      expect(checkCsrf(req(method, headers), ALLOWED)).toBe('bad_origin');
    });
  });

  it('rejects every origin when none is configured', () => {
    expect(
      checkCsrf(
        req('POST', {
          'x-gymtime-client': 'panel',
          origin: 'http://localhost:3000',
        }),
        [],
      ),
    ).toBe('bad_origin');
  });
});
