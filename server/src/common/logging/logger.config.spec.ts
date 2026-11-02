import { Writable } from 'node:stream';
import { pino } from 'pino';
import {
  REDACT_CENSOR,
  REDACT_PATHS,
  buildLoggerParams,
} from './logger.config.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = pino(
    { redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } },
    stream,
  );
  return { logger, lines };
}

describe('logger redaction', () => {
  it('hides credentials in request headers', () => {
    const { logger, lines } = capture();
    logger.info({
      req: {
        headers: {
          authorization: 'Bearer secret-1',
          'x-admin-key': 'secret-2',
          'x-device-token': 'secret-3',
        },
      },
    });
    expect(lines[0]).not.toMatch(/secret-/);
    expect(lines[0]).toContain(REDACT_CENSOR);
  });

  it('hides tokens and fingerprint templates', () => {
    const { logger, lines } = capture();
    logger.info({
      token: 'secret-1',
      msg: 'x',
      payload: { plantilla: 'AAAA', template: 'BBBB', token: 'secret-4' },
    });
    expect(lines[0]).not.toMatch(/secret-|AAAA|BBBB/);
  });

  it('keeps non sensitive fields', () => {
    const { logger, lines } = capture();
    logger.info({ deviceId: 'esp-1', messageId: 'm-1' }, 'hello');
    expect(lines[0]).toContain('esp-1');
  });
});

describe('buildLoggerParams', () => {
  it('uses the pretty transport only in development', () => {
    const dev = buildLoggerParams({
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug',
    });
    const prod = buildLoggerParams({
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    });
    expect((dev.pinoHttp as any).transport.target).toBe('pino-pretty');
    expect((dev.pinoHttp as any).level).toBe('debug');
    expect((prod.pinoHttp as any).transport).toBeUndefined();
    expect((prod.pinoHttp as any).level).toBe('warn');
  });
});
