import {
  DISPLAY_COLORS,
  UNKNOWN_DISPLAY,
  deniedDisplay,
  entryDisplay,
  exitDisplay,
} from './display.js';

describe('scan displays', () => {
  it('shows the name and result in Spanish', () => {
    expect(entryDisplay('Ana')).toEqual({
      line1: 'Entrada registrada',
      line2: 'Ana',
      color: DISPLAY_COLORS.accepted,
    });
    expect(exitDisplay('Ana')).toEqual({
      line1: 'Salida registrada',
      line2: 'Ana',
      color: DISPLAY_COLORS.accepted,
    });
  });

  it('explains the rejection with a short Spanish reason', () => {
    expect(deniedDisplay('ALREADY_EXITED', 'Ana')).toEqual({
      line1: 'Acceso denegado',
      line2: 'Ana: Ya registró su salida',
      color: DISPLAY_COLORS.rejected,
    });
    expect(deniedDisplay('UNKNOWN_SLOT', null)).toEqual({
      line1: 'Acceso denegado',
      line2: 'Huella no registrada',
      color: DISPLAY_COLORS.rejected,
    });
  });

  it('announces an unrecognised fingerprint', () => {
    expect(UNKNOWN_DISPLAY).toEqual({
      line1: 'Huella no reconocida',
      line2: '',
      color: DISPLAY_COLORS.rejected,
    });
  });
});
