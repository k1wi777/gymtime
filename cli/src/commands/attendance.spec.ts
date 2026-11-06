import { describe, expect, it } from 'vitest';
import { fakeServer, invoke, type Call } from '../testing.js';

const ana = {
  id: 'sid',
  document: '123',
  name: 'Ana',
  program: null,
  active: true,
  consented: true,
};
const instance = {
  id: 'i1',
  scheduleId: 'sch1',
  startsAt: '2026-11-02T15:00:00.000Z',
  endsAt: '2026-11-02T16:00:00.000Z',
};
const registered = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  student: { id: 'sid', document: '123', name: 'Ana' },
  enteredAt: '2026-11-02T15:10:00.000Z',
  instance,
  exitedAt: null,
  entrySource: 'manual',
  exitSource: null,
  status: 'abierta',
  manualReason: 'olvidó la huella',
  ...over,
});

function server(session = registered()) {
  return fakeServer((call: Call) => {
    if (call.path === '/students') return { body: [ana] };
    if (call.method === 'POST' && call.path === '/attendance/entry') {
      return { status: 201, body: session };
    }
    if (call.method === 'POST' && call.path === '/attendance/exit') {
      return { status: 200, body: session };
    }
    return { status: 404 };
  });
}

describe('attendance entry/exit', () => {
  it('registers a manual entry with the reason', async () => {
    const s = server();
    const { code, out } = await invoke(
      [
        'attendance',
        'entry',
        '--student',
        '123',
        '--reason',
        'olvidó la huella',
      ],
      { fetch: s.fetch },
    );
    expect(code).toBe(0);
    expect(s.calls[1]).toMatchObject({
      method: 'POST',
      path: '/attendance/entry',
      body: { studentId: 'sid', reason: 'olvidó la huella' },
    });
    expect(out).toContain('Entry registered.');
    expect(out).toContain('Ana');
    expect(out).toContain('abierta');
  });

  it('registers a manual exit with the reason', async () => {
    const s = server(
      registered({
        status: 'cerrada',
        exitSource: 'manual',
        exitedAt: '2026-11-02T15:40:00.000Z',
      }),
    );
    const { code, out } = await invoke(
      ['attendance', 'exit', '--student', '123', '--reason', 'se retiró'],
      { fetch: s.fetch },
    );
    expect(code).toBe(0);
    expect(s.calls[1]).toMatchObject({
      method: 'POST',
      path: '/attendance/exit',
      body: { studentId: 'sid', reason: 'se retiró' },
    });
    expect(out).toContain('Exit registered.');
    expect(out).toContain('cerrada');
  });

  it('requires --reason and --student as usage errors', async () => {
    const s = server();
    const noReason = await invoke(['attendance', 'entry', '--student', '123'], {
      fetch: s.fetch,
    });
    expect(noReason.code).toBe(2);
    expect(noReason.err).toContain('--reason');
    const noStudent = await invoke(['attendance', 'exit', '--reason', 'x'], {
      fetch: s.fetch,
    });
    expect(noStudent.code).toBe(2);
    expect(noStudent.err).toContain('--student');
  });

  it('fails when the document does not exist', async () => {
    const s = fakeServer(() => ({ body: [] }));
    const { code, err } = await invoke(
      ['attendance', 'entry', '--student', '999', '--reason', 'x'],
      { fetch: s.fetch },
    );
    expect(code).toBe(1);
    expect(err).toContain('No student with document 999');
  });
});
