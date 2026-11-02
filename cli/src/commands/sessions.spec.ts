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
const openSession = {
  id: 's1',
  student: { id: 'sid', document: '123', name: 'Ana' },
  enteredAt: '2026-11-02T15:10:00.000Z',
  instance,
};
const session = {
  ...openSession,
  exitedAt: null,
  entrySource: 'device',
  exitSource: null,
  status: 'abierta',
  manualReason: null,
};

function server() {
  return fakeServer((call: Call) => {
    if (call.path === '/students') return { body: [ana] };
    if (call.path === '/attendance/open') return { body: [openSession] };
    if (call.path.startsWith('/attendance/sessions')) {
      return { body: [session] };
    }
    return { status: 404 };
  });
}

describe('sessions open', () => {
  it('lists who is inside with the entry time in Bogota', async () => {
    const s = server();
    const { code, out } = await invoke(['sessions', 'open'], { fetch: s.fetch });
    expect(code).toBe(0);
    expect(s.calls[0]).toMatchObject({ method: 'GET', path: '/attendance/open' });
    expect(out).toContain('123');
    expect(out).toContain('Ana');
    expect(out).toContain('2026-11-02 10:10');
  });
});

describe('sessions list', () => {
  it('resolves the document and forwards the filters', async () => {
    const s = server();
    const { code, out } = await invoke(
      [
        'sessions',
        'list',
        '--student',
        '123',
        '--status',
        'abierta',
        '--limit',
        '10',
      ],
      { fetch: s.fetch },
    );
    expect(code).toBe(0);
    expect(s.calls[1]).toMatchObject({
      method: 'GET',
      path: '/attendance/sessions?studentId=sid&status=abierta&limit=10',
    });
    expect(out).toContain('abierta');
    expect(out).toContain('device');
  });

  it('rejects an invalid status or limit as a usage error', async () => {
    const s = server();
    const badStatus = await invoke(
      ['sessions', 'list', '--status', 'open'],
      { fetch: s.fetch },
    );
    expect(badStatus.code).toBe(2);
    expect(badStatus.err).toContain('--status');
    const badLimit = await invoke(['sessions', 'list', '--limit', '0'], {
      fetch: s.fetch,
    });
    expect(badLimit.code).toBe(2);
    expect(badLimit.err).toContain('--limit');
  });

  it('fails when the document does not exist', async () => {
    const s = fakeServer(() => ({ body: [] }));
    const { code, err } = await invoke(
      ['sessions', 'list', '--student', '999'],
      { fetch: s.fetch },
    );
    expect(code).toBe(1);
    expect(err).toContain('No student with document 999');
  });
});
