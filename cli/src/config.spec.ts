import { describe, expect, it } from 'vitest';
import { DEFAULT_URL, resolveConfig } from './config.js';
import { ConfigError } from './errors.js';

const none = () => undefined;
const file = (content: string) => () => content;

describe('resolveConfig', () => {
  it('uses the default URL but requires a key', () => {
    expect(() =>
      resolveConfig({ options: {}, env: {}, readFile: none }),
    ).toThrow(ConfigError);
    expect(
      resolveConfig({ options: {}, env: { GYM_API_KEY: 'k' }, readFile: none }),
    ).toEqual({ url: DEFAULT_URL, apiKey: 'k' });
  });

  it('applies option > env > file > default', () => {
    const readFile = file('{"url":"http://file:1","apiKey":"file-key"}');
    expect(resolveConfig({ options: {}, env: {}, readFile })).toEqual({
      url: 'http://file:1',
      apiKey: 'file-key',
    });
    const env = { GYM_URL: 'http://env:2', GYM_API_KEY: 'env-key' };
    expect(resolveConfig({ options: {}, env, readFile })).toEqual({
      url: 'http://env:2',
      apiKey: 'env-key',
    });
    const options = { url: 'https://opt:3/', apiKey: 'opt-key' };
    expect(resolveConfig({ options, env, readFile })).toEqual({
      url: 'https://opt:3',
      apiKey: 'opt-key',
    });
  });

  it('reads the file from GYM_CONFIG', () => {
    const paths: string[] = [];
    resolveConfig({
      options: { apiKey: 'k' },
      env: { GYM_CONFIG: '/x/cli.json' },
      readFile: (path) => (paths.push(path), undefined),
    });
    expect(paths).toEqual(['/x/cli.json']);
  });

  it('rejects an invalid URL naming option and variable, not the value', () => {
    const attempt = () =>
      resolveConfig({
        options: { url: 'ftp://secret-host', apiKey: 'k' },
        env: {},
        readFile: none,
      });
    expect(attempt).toThrow(/--url \/ GYM_URL/);
    expect(attempt).not.toThrow(/secret-host/);
  });

  it('names the missing key sources without leaking any value', () => {
    expect(() =>
      resolveConfig({ options: {}, env: {}, readFile: none }),
    ).toThrow(/--api-key, GYM_API_KEY/);
  });

  it('fails on an unreadable or invalid file without printing its content', () => {
    const bad = () =>
      resolveConfig({
        options: {},
        env: {},
        readFile: file('{"apiKey": "super-secret"'),
      });
    expect(bad).toThrow(/not valid JSON/);
    expect(bad).not.toThrow(/super-secret/);
    expect(() =>
      resolveConfig({
        options: {},
        env: {},
        readFile: () => {
          throw new Error('EACCES');
        },
      }),
    ).toThrow(/Cannot read/);
    expect(() =>
      resolveConfig({ options: {}, env: {}, readFile: file('[]') }),
    ).toThrow(/must be an object/);
  });
});
