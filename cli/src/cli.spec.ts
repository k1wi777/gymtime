import { describe, expect, it } from 'vitest';
import { fakeServer, invoke } from './testing.js';

describe('gym routing and help', () => {
  it('lists every group and action in --help', async () => {
    const { code, out } = await invoke(['--help']);
    expect(code).toBe(0);
    for (const usage of [
      'student add',
      'student list',
      'student remove',
      'enroll start',
      'enroll cancel',
    ]) {
      expect(out).toContain(usage);
    }
    expect((await invoke([])).out).toContain('Commands:');
  });

  it('shows help per group and per command', async () => {
    const group = await invoke(['student', '--help']);
    expect(group.code).toBe(0);
    expect(group.out).toContain('student remove <document>');
    expect(group.out).not.toContain('enroll start');
    const command = await invoke(['enroll', 'start', '--help']);
    expect(command.code).toBe(0);
    expect(command.out).toContain('Usage: gym enroll start --student');
  });

  it('does not need configuration to show help', async () => {
    const { code } = await invoke(['student', 'list', '-h'], { env: {} });
    expect(code).toBe(0);
  });

  it('rejects unknown groups, actions and options with usage and exit 2', async () => {
    for (const argv of [
      ['nope'],
      ['student', 'nope'],
      ['student', 'list', '--bogus'],
      ['student', 'add'],
      ['student', 'list', 'extra'],
    ]) {
      const { code, err, out } = await invoke(argv);
      expect(code, argv.join(' ')).toBe(2);
      expect(err).toMatch(/Error: .+/);
      expect(err).toMatch(/Usage:/);
      expect(out).toBe('');
    }
  });

  it('requires an action for a group', async () => {
    const { code, out } = await invoke(['student']);
    expect(code).toBe(0);
    expect(out).toContain('Actions:');
  });

  it('reports configuration errors with exit 1 and no secret', async () => {
    const { code, err } = await invoke(['student', 'list'], { env: {} });
    expect(code).toBe(1);
    expect(err).toMatch(/--api-key, GYM_API_KEY/);
    const bad = await invoke(['student', 'list', '--url', 'nope'], {
      env: { GYM_API_KEY: 'super-secret' },
    });
    expect(bad.code).toBe(1);
    expect(bad.err).not.toContain('super-secret');
  });

  it('sends the key from option over environment and reports server errors', async () => {
    const server = fakeServer(() => ({
      status: 500,
      body: { message: 'boom' },
    }));
    const { code, err } = await invoke(
      ['student', 'list', '--api-key', 'opt-key'],
      { fetch: server.fetch },
    );
    expect(server.calls[0]?.apiKey).toBe('opt-key');
    expect(code).toBe(1);
    expect(err).toBe('Error: Server responded 500: boom');
    expect(err).not.toContain('opt-key');
  });

  it('reports an unreachable server without a stack', async () => {
    const { code, err } = await invoke(['student', 'list'], {
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(code).toBe(1);
    expect(err).toBe('Error: Could not connect to http://srv');
  });
});
