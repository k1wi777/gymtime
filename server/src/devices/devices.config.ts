export interface DevicesConfig {
  /** Time a new connection has to send a valid hello. */
  helloTimeoutMs: number;
  /** Time to wait for the ack of an outbound message before resending. */
  ackTimeoutMs: number;
  /** Resends after the first attempt. */
  maxResends: number;
  heartbeatSec: number;
}

export const DEVICES_CONFIG = Symbol('DEVICES_CONFIG');

export const defaultDevicesConfig: DevicesConfig = {
  helloTimeoutMs: 5000,
  ackTimeoutMs: 5000,
  maxResends: 3,
  heartbeatSec: 30,
};
