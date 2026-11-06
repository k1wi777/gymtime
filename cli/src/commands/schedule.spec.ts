import { describe, expect, it } from 'vitest';
import { fakeServer, invoke, type Call } from '../testing.js';
import { parseEndsIn } from './schedule.js';

const ana = {
  id: 'sid',
  document: '123',
  name: 'Ana',
  program: null,
  active: true,
  consented: true,
};
const NOW = Date.parse('2026-11-02T14:00:00Z');

const schedule = (over: Record<string, unknown> = {}) => ({
  id: 'sch1',
  name: 'Morning',
  weekday: 1,
  date: null,
  startTime: '10:00:00',
  endTime: '11:00:00',
  entryOpenMinutes: null,
  entryCloseMinutes: null,
  students: [],
  upcoming: [
    {
      id: 'i1',
      date: '2026-11-09',
      startsAt: '2026-11-09T15:00:00.000Z',
      endsAt: '2026-11-09T16:00:00.000Z',
    },
  ],
  ...over,
});

function server(created = schedule(), shown = created) {
  return fakeServer((call: Call) => {
    if (call.path === '/students') return { body: [ana] };
    if (call.method === 'POST' && call.path === '/schedules')
      return { status: 201, body: created };
    if (call.method === 'PUT') return { status: 204, body: undefined };
    if (call.method === 'GET' && call.path === '/schedules')
      return { body: [shown] };
    if (call.method === 'GET') return { body: shown };
    return { status: 404 };
  });
}

describe('parseEndsIn', () => {
  it('accepts 3m and 3, rejects the rest', () => {
    expect(parseEndsIn('3m')).toBe(3);
    expect(parseEndsIn('15')).toBe(15);
    for (const bad of ['0', '0m', 'x', '-3m', '3h', '']) {
      expect(() => parseEndsIn(bad)).toThrow(/--ends-in/);
    }
  });
});

describe('schedule create', () => {
  it('creates a weekly schedule and assigns students resolved by document', async () => {
    const shown = schedule({
      students: [{ id: 'sid', document: '123', name: 'Ana', active: true }],
    });
    const s = server(schedule(), shown);
    const { code, out } = await invoke(
      [
        'schedule',
        'create',
        '--name',
        'Morning',
        '--weekday',
        '1',
        '--start',
        '10:00',
        '--end',
        '11:00',
        '--student',
        '123',
      ],
      { fetch: s.fetch, now: () => NOW },
    );
    expect(code).toBe(0);
    const post = s.calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({
      name: 'Morning',
      weekday: 1,
      start: '10:00',
      end: '11:00',
    });
    expect(
      s.calls.some(
        (c) => c.method === 'PUT' && c.path === '/schedules/sch1/students/sid',
      ),
    ).toBe(true);
    expect(out).toContain('Schedule created.');
    expect(out).toContain('Ana');
    expect(out).toContain('2026-11-09 10:00 - 11:00'); // Bogota, not UTC
    expect(out).not.toContain('gym sync');
  });

  it('sends the period given by id or by name', async () => {
    const periodId = '11111111-1111-4111-8111-111111111111';
    const s = fakeServer((call: Call) => {
      if (call.method === 'GET' && call.path === '/periods') {
        return { body: [{ id: periodId, name: '2026-2', active: true }] };
      }
      if (call.method === 'POST') return { status: 201, body: schedule() };
      return { status: 404 };
    });
    const base = [
      'schedule',
      'create',
      '--name',
      'M',
      '--weekday',
      '1',
      '--start',
      '10:00',
      '--end',
      '11:00',
    ];
    for (const period of ['2026-2', periodId]) {
      const { code } = await invoke([...base, '--period', period], {
        fetch: s.fetch,
        now: () => NOW,
      });
      expect(code).toBe(0);
    }
    const posts = s.calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => (c.body as { periodId: string }).periodId)).toEqual(
      [periodId, periodId],
    );
    const missing = await invoke([...base, '--period', 'nope'], {
      fetch: s.fetch,
    });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('No period named "nope"');
  });

  it('sends only endsInMinutes for --ends-in and tells to run gym sync', async () => {
    const quick = schedule({
      weekday: null,
      date: '2026-11-02',
      startTime: '09:00:00',
      endTime: '09:03:00',
      upcoming: [
        {
          id: 'i1',
          date: '2026-11-02',
          startsAt: '2026-11-02T14:00:00.000Z',
          endsAt: '2026-11-02T14:03:00.000Z',
        },
      ],
    });
    const s = server(quick);
    const { code, out } = await invoke(
      ['schedule', 'create', '--name', 'Test', '--ends-in', '3m'],
      {
        fetch: s.fetch,
        now: () => NOW + 1000,
      },
    );
    expect(code).toBe(0);
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Test',
      endsInMinutes: 3,
    });
    expect(out).toContain('gym sync');
  });

  it('fails before creating anything when a student document is unknown', async () => {
    const s = server();
    const { code, err } = await invoke(
      [
        'schedule',
        'create',
        '--name',
        'X',
        '--ends-in',
        '3m',
        '--student',
        '999',
      ],
      { fetch: s.fetch },
    );
    expect(code).toBe(1);
    expect(err).toContain('No student with document 999');
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it.each([
    [
      'no weekday nor date',
      ['--name', 'X', '--start', '10:00', '--end', '11:00'],
    ],
    [
      'both weekday and date',
      [
        '--name',
        'X',
        '--weekday',
        '1',
        '--date',
        '2026-11-02',
        '--start',
        '10:00',
        '--end',
        '11:00',
      ],
    ],
    [
      '--ends-in mixed with --start',
      ['--name', 'X', '--ends-in', '3m', '--start', '10:00'],
    ],
    ['no start', ['--name', 'X', '--weekday', '1', '--end', '11:00']],
    [
      'non numeric weekday',
      ['--name', 'X', '--weekday', 'mon', '--start', '10:00', '--end', '11:00'],
    ],
    ['no name', ['--ends-in', '3m']],
  ])('rejects %s with a usage error', async (_label, args) => {
    const s = server();
    const { code } = await invoke(['schedule', 'create', ...args], {
      fetch: s.fetch,
    });
    expect(code).toBe(2);
    expect(s.calls).toHaveLength(0);
  });

  it('shows the server validation message', async () => {
    const s = fakeServer((call) =>
      call.path === '/students'
        ? { body: [ana] }
        : { status: 400, body: { message: 'end must be later than start' } },
    );
    const { code, err } = await invoke(
      [
        'schedule',
        'create',
        '--name',
        'X',
        '--weekday',
        '1',
        '--start',
        '11:00',
        '--end',
        '10:00',
      ],
      { fetch: s.fetch },
    );
    expect(code).toBe(1);
    expect(err).toContain('end must be later than start');
  });
});

describe('schedule assign, list and show', () => {
  it('assigns a student by document', async () => {
    const s = server();
    const { code, out } = await invoke(
      ['schedule', 'assign', '--schedule', 'sch1', '--student', '123'],
      { fetch: s.fetch },
    );
    expect(code).toBe(0);
    expect(s.calls.at(-1)).toMatchObject({
      method: 'PUT',
      path: '/schedules/sch1/students/sid',
    });
    expect(out).toContain('Ana');
  });

  it('lists schedules in a table with Bogota times', async () => {
    const s = server();
    const { code, out } = await invoke(['schedule', 'list'], {
      fetch: s.fetch,
    });
    expect(code).toBe(0);
    expect(out).toContain('Morning');
    expect(out).toContain('Mon 10:00-11:00');
    expect(out).toContain('2026-11-09 10:00');
  });

  it('says so when there are no schedules', async () => {
    const s = fakeServer(() => ({ body: [] }));
    expect(
      (await invoke(['schedule', 'list'], { fetch: s.fetch })).out,
    ).toContain('No schedules found.');
  });

  it('shows one schedule and requires --schedule', async () => {
    const s = server();
    const ok = await invoke(['schedule', 'show', '--schedule', 'sch1'], {
      fetch: s.fetch,
    });
    expect(ok.out).toContain('id:         sch1');
    expect(ok.out).toContain('upcoming:');
    expect((await invoke(['schedule', 'show'], { fetch: s.fetch })).code).toBe(
      2,
    );
  });
});
