import { describe, expect, it } from 'vitest';
import { fakeServer, invoke, type Call } from '../testing.js';

const status = (over: Record<string, unknown> = {}) => ({
  on: true,
  reason: 'PENDING_EXIT',
  instanceId: '00000000-0000-4000-8000-0000000000a1',
  durationSec: null,
  startedAt: '2026-11-02T16:00:00.000Z',
  openSessions: 2,
  ...over,
});

function server(
  handler?: (call: Call) => { status?: number; body?: unknown } | undefined,
) {
  return fakeServer((call) => {
    const overridden = handler?.(call);
    if (overridden) return overridden;
    if (call.path === '/alarm/status') return { body: status() };
    if (call.path === '/alarm/on')
      return { status: 200, body: status({ reason: 'MANUAL' }) };
    if (call.path === '/alarm/test')
      return { status: 200, body: status({ reason: 'TEST', durationSec: 5 }) };
    if (call.path === '/alarm/off')
      return {
        status: 200,
        body: {
          closedBy: 'cli',
          sessionsClosed: 2,
          status: status({ on: false, reason: 'CLEARED' }),
        },
      };
    return { status: 404, body: { message: 'not found' } };
  });
}

describe('gym alarm', () => {
  it('shows the status with reason, duration and open sessions in Bogota', async () => {
    const s = server();
    const { code, out } = await invoke(['alarm', 'status'], { fetch: s.fetch });

    expect(code).toBe(0);
    expect(out).toContain('ON (PENDING_EXIT)');
    expect(out).toContain('continuous');
    expect(out).toContain('2026-11-02 11:00');
    expect(out).toContain('open sessions:  2');
  });

  it('turns the alarm on, tests and silences through the REST API', async () => {
    const s = server();
    const on = await invoke(['alarm', 'on'], { fetch: s.fetch });
    expect(on.code).toBe(0);
    expect(s.calls[0]).toMatchObject({ method: 'POST', path: '/alarm/on' });
    expect(on.out).toContain('Alarm on.');
    expect(on.out).toContain('MANUAL');

    const test = await invoke(['alarm', 'test'], { fetch: s.fetch });
    expect(test.code).toBe(0);
    expect(s.calls[1]).toMatchObject({ method: 'POST', path: '/alarm/test' });
    expect(test.out).toContain('5 s');

    const off = await invoke(['alarm', 'off'], { fetch: s.fetch });
    expect(off.code).toBe(0);
    expect(s.calls[2]).toMatchObject({ method: 'POST', path: '/alarm/off' });
    expect(off.out).toContain('2 session(s) marked no_registrada');
    expect(off.out).toContain('OFF (last CLEARED)');
  });

  it('turns a server rule error into exit code 1 with its message', async () => {
    const s = server((call) =>
      call.path === '/alarm/off'
        ? {
            status: 409,
            body: {
              code: 'ALARM_NOT_ON',
              message: 'La alarma no está encendida',
            },
          }
        : undefined,
    );
    const { code, err } = await invoke(['alarm', 'off'], { fetch: s.fetch });

    expect(code).toBe(1);
    expect(err).toContain('La alarma no está encendida');
  });

  it('rejects unexpected positionals as a usage error', async () => {
    const s = server();
    const { code, err } = await invoke(['alarm', 'status', 'extra'], {
      fetch: s.fetch,
    });
    expect(code).toBe(2);
    expect(err).toContain('unexpected argument');
  });
});
