import { checkPassword } from './password-policy.js';

describe('checkPassword (R5)', () => {
  it('accepts 10 to 128 characters', () => {
    expect(checkPassword('a'.repeat(10), 'ana')).toBeNull();
    expect(checkPassword('a'.repeat(128), 'ana')).toBeNull();
  });

  it('rejects shorter and longer passwords', () => {
    expect(checkPassword('a'.repeat(9), 'ana')).toBe('too_short');
    expect(checkPassword('a'.repeat(129), 'ana')).toBe('too_long');
  });

  it('counts characters, not bytes', () => {
    expect(checkPassword('ñ'.repeat(10), 'ana')).toBeNull();
  });

  it('rejects the username, whatever its case', () => {
    expect(checkPassword('administrador', ' Administrador ')).toBe(
      'same_as_username',
    );
  });
});
