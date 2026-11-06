import { DISPLAY_LINE_MAX, displayLineHelp } from '@/lib/display';
import {
  safeNext,
  validateLogin,
  validateManual,
  validateMessage,
  validatePasswordChange,
} from '@/lib/validators';

describe('validators', () => {
  it('login asks for both fields', () => {
    expect(validateLogin({ username: ' ', password: '' })).toEqual({
      username: 'Escriba el usuario.',
      password: 'Escriba la contraseña.',
    });
    expect(validateLogin({ username: 'ana', password: 'x' })).toEqual({});
  });

  it('password change enforces 10 to 128 characters, difference and confirmation', () => {
    const base = {
      currentPassword: 'old-password-1',
      newPassword: 'new-password-1',
      confirmPassword: 'new-password-1',
    };
    expect(validatePasswordChange(base)).toEqual({});
    expect(
      validatePasswordChange({
        ...base,
        newPassword: 'short',
        confirmPassword: 'short',
      }).newPassword,
    ).toContain('al menos 10');
    const long = 'x'.repeat(129);
    expect(
      validatePasswordChange({
        ...base,
        newPassword: long,
        confirmPassword: long,
      }).newPassword,
    ).toContain('128');
    expect(
      validatePasswordChange({
        ...base,
        newPassword: base.currentPassword,
        confirmPassword: base.currentPassword,
      }).newPassword,
    ).toContain('distinta');
    expect(
      validatePasswordChange({ ...base, confirmPassword: 'other-password' })
        .confirmPassword,
    ).toContain('no coinciden');
  });

  it('counts password characters like the server (code points)', () => {
    const emoji = '😀'.repeat(10);
    expect(
      validatePasswordChange({
        currentPassword: 'a',
        newPassword: emoji,
        confirmPassword: emoji,
      }),
    ).toEqual({});
  });

  it('manual registration requires a student and a non-blank reason', () => {
    expect(validateManual({ studentId: '', reason: '   ' })).toEqual({
      studentId: 'Elija un estudiante.',
      reason: 'El motivo es obligatorio.',
    });
    expect(
      validateManual({ studentId: 's', reason: 'olvidó la huella' }),
    ).toEqual({});
  });

  it('message lines are limited to 16 characters and line 1 is required', () => {
    expect(validateMessage({ line1: '', line2: '' }).line1).toContain(
      'obligatoria',
    );
    expect(validateMessage({ line1: 'x'.repeat(16), line2: '' })).toEqual({});
    expect(
      validateMessage({ line1: 'x'.repeat(17), line2: 'y'.repeat(20) }),
    ).toEqual({
      line1: 'Máximo 16 caracteres (lleva 17).',
      line2: 'Máximo 16 caracteres (lleva 20).',
    });
  });

  it('the help text of the lines is built from the same constant', () => {
    expect(DISPLAY_LINE_MAX).toBe(16);
    expect(displayLineHelp).toContain(String(DISPLAY_LINE_MAX));
  });

  it('only follows redirects that stay inside the panel', () => {
    expect(safeNext('/horarios?x=1')).toBe('/horarios?x=1');
    for (const bad of [
      '//evil.com',
      'https://evil.com',
      '/login',
      null,
      undefined,
      '',
      '/\\evil',
    ]) {
      expect(safeNext(bad)).toBe('/ahora');
    }
  });
});
