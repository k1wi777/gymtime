import { ConfigError, loadConfig } from './config.js';

const DEFAULT_ENROLL = {
  mode: 'ok',
  stepMs: 800,
  failReason: 'simulated_failure',
  templateBytes: 512,
};

describe('loadConfig', () => {
  it('applies defaults except for the token', () => {
    expect(loadConfig({ SIM_DEVICE_TOKEN: 'tok-123456789012' }, [])).toEqual({
      url: 'ws://localhost:3000/device',
      deviceId: 'esp32-sim-01',
      token: 'tok-123456789012',
      fw: 'sim-1.0.0',
      enroll: DEFAULT_ENROLL,
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
      enroll: DEFAULT_ENROLL,
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

  describe('enrollment options', () => {
    const base = { SIM_DEVICE_TOKEN: 'tok-123456789012' };

    it('reads them from the environment', () => {
      const config = loadConfig(
        {
          ...base,
          SIM_ENROLL_MODE: 'fail',
          SIM_ENROLL_STEP_MS: '0',
          SIM_ENROLL_FAIL_REASON: 'env_reason',
          SIM_TEMPLATE_BYTES: '300',
        },
        [],
      );
      expect(config.enroll).toEqual({
        mode: 'fail',
        stepMs: 0,
        failReason: 'env_reason',
        templateBytes: 300,
      });
    });

    it('lets arguments win over the environment', () => {
      const config = loadConfig({ ...base, SIM_ENROLL_MODE: 'fail' }, [
        '--enroll-mode',
        'silent',
        '--enroll-step-ms',
        '50',
        '--enroll-fail-reason',
        'arg_reason',
        '--template-bytes',
        '64',
      ]);
      expect(config.enroll).toEqual({
        mode: 'silent',
        stepMs: 50,
        failReason: 'arg_reason',
        templateBytes: 64,
      });
    });

    it.each([
      [['--enroll-mode', 'loud'], /--enroll-mode \/ SIM_ENROLL_MODE/],
      [['--enroll-step-ms=-1'], /--enroll-step-ms \/ SIM_ENROLL_STEP_MS/],
      [['--enroll-step-ms', '1.5'], /--enroll-step-ms/],
      [['--template-bytes', '0'], /--template-bytes \/ SIM_TEMPLATE_BYTES/],
      [['--template-bytes', 'abc'], /--template-bytes/],
      [['--enroll-fail-reason', ''], /--enroll-fail-reason/],
    ])('rejects %j without echoing secrets', (args, pattern) => {
      const run = () =>
        loadConfig({ SIM_DEVICE_TOKEN: 'super-secret-token' }, args);
      expect(run).toThrow(ConfigError);
      expect(run).toThrow(pattern);
      expect(run).not.toThrow(/super-secret-token/);
    });
  });

  it('offline mode is opt-in and carries offset and state file', () => {
    const env = { SIM_DEVICE_TOKEN: 'tok-123456789012' };
    expect(loadConfig(env, []).offline).toBeUndefined();
    expect(
      loadConfig(env, [
        '--offline',
        '--clock-offset-sec=-45',
        '--state-file',
        '/tmp/x.jsonl',
      ]).offline,
    ).toEqual({ clockOffsetSec: -45, stateFile: '/tmp/x.jsonl' });
    expect(loadConfig({ ...env, SIM_OFFLINE: '1' }, []).offline).toEqual({
      clockOffsetSec: 0,
      stateFile: null,
    });
  });

  it('refuses offset or state file without --offline', () => {
    const env = { SIM_DEVICE_TOKEN: 'tok-123456789012' };
    expect(() => loadConfig(env, ['--clock-offset-sec', '5'])).toThrow(
      /need --offline/,
    );
    expect(() =>
      loadConfig(env, ['--offline', '--clock-offset-sec', 'x']),
    ).toThrow(/--clock-offset-sec/);
  });
});
