import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults except for the token', () => {
    expect(loadConfig({ SIM_DEVICE_TOKEN: 'tok-123456789012' }, [])).toEqual({
      url: 'ws://localhost:3000/device',
      deviceId: 'esp32-sim-01',
      token: 'tok-123456789012',
      fw: 'sim-1.0.0',
    });
  });

  it('lets arguments win over the environment', () => {
    const config = loadConfig(
      {
        SIM_URL: 'ws://env:1/device',
        SIM_DEVICE_ID: 'env-id',
        SIM_DEVICE_TOKEN: 'env-token',
        SIM_FW: 'env-fw',
      },
      [
        '--url',
        'wss://arg/device',
        '--device-id',
        'arg-id',
        '--token',
        'arg-token',
        '--fw',
        'arg-fw',
      ],
    );
    expect(config).toEqual({
      url: 'wss://arg/device',
      deviceId: 'arg-id',
      token: 'arg-token',
      fw: 'arg-fw',
    });
  });

  it('reports a missing token naming the option', () => {
    expect(() => loadConfig({}, [])).toThrow(/--token \/ SIM_DEVICE_TOKEN/);
  });

  it('rejects a non-websocket URL without echoing the token', () => {
    const run = () =>
      loadConfig({ SIM_DEVICE_TOKEN: 'super-secret-token' }, [
        '--url',
        'http://x',
      ]);
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/--url \/ SIM_URL/);
    try {
      run();
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-token');
    }
  });

  it('rejects unknown arguments', () => {
    expect(() => loadConfig({ SIM_DEVICE_TOKEN: 't' }, ['--bogus'])).toThrow(
      ConfigError,
    );
  });
});
