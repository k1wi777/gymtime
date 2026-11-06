/** No device is known to receive the message. */
export class NoDeviceError extends Error {
  constructor() {
    super('No device known: connect one or name it with deviceId');
  }
}
