export type AlarmErrorCode = 'ALARM_NOT_ON' | 'NO_DEVICE_ONLINE';

const MESSAGES: Record<AlarmErrorCode, string> = {
  ALARM_NOT_ON: 'La alarma no está encendida',
  NO_DEVICE_ONLINE: 'No hay un dispositivo en línea',
};

/** Business rule rejection; the controller maps it to HTTP 409. */
export class AlarmError extends Error {
  constructor(readonly code: AlarmErrorCode) {
    super(MESSAGES[code]);
    this.name = 'AlarmError';
  }
}
