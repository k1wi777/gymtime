import { checkPassword } from './password-policy.js';
import { generateTemporaryPassword } from './temporary-password.js';

describe('generateTemporaryPassword', () => {
  it('meets the password policy and avoids ambiguous characters', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(16);
      expect(password).not.toMatch(/[0O1lI]/);
      expect(checkPassword(password, 'someone')).toBeNull();
    }
  });

  it('does not repeat', () => {
    const all = new Set(
      Array.from({ length: 100 }, () => generateTemporaryPassword()),
    );
    expect(all.size).toBe(100);
  });
});
