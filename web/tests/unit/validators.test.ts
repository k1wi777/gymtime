import {
  DISPLAY_SUBTITLE_MAX,
  DISPLAY_TITLE_MAX,
  DISPLAY_TONES,
  displaySubtitleHelp,
  displayTitleHelp,
} from '@/lib/display';
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

  const message = { title: 'Hola', subtitle: '', tone: 'info', seconds: '' };

  it('message: the title is required and limited, the subtitle has a size and line limit', () => {
    expect(validateMessage({ ...message, title: ' ' }).title).toContain(
      'obligatorio',
    );
    expect(validateMessage({ ...message, title: 'ñ'.repeat(32) })).toEqual({});
    expect(
      validateMessage({
        ...message,
        title: 'x'.repeat(33),
        subtitle: 'y'.repeat(81),
      }),
    ).toEqual({
      title: 'Máximo 32 caracteres (lleva 33).',
      subtitle: 'Máximo 80 caracteres (lleva 81).',
    });
    expect(validateMessage({ ...message, subtitle: 'a\nb' })).toEqual({});
    expect(validateMessage({ ...message, subtitle: 'a\nb\nc' }).subtitle).toBe(
      'Máximo 2 líneas (lleva 3).',
    );
  });

  it('message: the tone must be known and the seconds a whole number from 1 to 60', () => {
    for (const tone of DISPLAY_TONES) {
      expect(validateMessage({ ...message, tone })).toEqual({});
    }
    expect(validateMessage({ ...message, tone: 'purple' }).tone).toBeDefined();
    for (const seconds of ['0', '61', '1.5', 'abc']) {
      expect(validateMessage({ ...message, seconds }).seconds).toBeDefined();
    }
    expect(validateMessage({ ...message, seconds: '60' })).toEqual({});
  });

  it('the help texts are built from the same constants', () => {
    expect(DISPLAY_TITLE_MAX).toBe(32);
    expect(DISPLAY_SUBTITLE_MAX).toBe(80);
    expect(displayTitleHelp).toContain(String(DISPLAY_TITLE_MAX));
    expect(displaySubtitleHelp).toContain(String(DISPLAY_SUBTITLE_MAX));
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
