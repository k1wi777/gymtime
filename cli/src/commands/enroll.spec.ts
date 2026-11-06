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
const base = {
  id: 'eid',
  studentId: 'sid',
  deviceId: 'esp32-sim-01',
  step: null,
  failureReason: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const state = (
  status: string,
  step: string | null = null,
  failureReason: string | null = null,
) => ({
  ...base,
  status,
  step,
  failureReason,
});

/** Serves the student list, a start answer and a sequence of GET states. */
function scenario(
  sequence: ReturnType<typeof state>[],
  extra?: (
    call: Call,
  ) => ReturnType<Parameters<typeof fakeServer>[0]> | undefined,
) {
  const queue = [...sequence];
  return fakeServer((call) => {
    const custom = extra?.(call);
    if (custom) return custom;
    if (call.path === '/students')
      return {
        body: [ana, { ...ana, id: 'old', document: '999', active: false }],
      };
    if (call.method === 'POST' && call.path === '/students/sid/enrollments')
      return { status: 201, body: state('pending') };
    if (call.method === 'GET')
      return { body: queue.length > 1 ? queue.shift() : queue[0] };
    return { body: state('cancelled') };
  });
}

describe('enroll start', () => {
  it('shows each step once and exits 0 on done', async () => {
    const server = scenario([
      state('in_progress'),
      state('in_progress', 'place_finger'),
      state('in_progress', 'place_finger'),
      state('in_progress', 'remove_finger'),
      state('in_progress', 'place_again'),
      state('in_progress', 'processing'),
      state('done', 'processing'),
    ]);
    const { code, out } = await invoke(
      ['enroll', 'start', '--student', '123'],
      { fetch: server.fetch },
    );
    expect(code).toBe(0);
    const lines = out.split('\n');
    expect(lines[0]).toContain('Enrollment eid started');
    expect(lines.slice(1)).toEqual([
      'Waiting for the device to accept the enrollment...',
      'Enrollment in progress...',
      'Place the finger on the reader',
      'Remove the finger from the reader',
      'Place the same finger again',
      'Processing the fingerprint...',
      'Done: fingerprint enrolled.',
    ]);
  });

  it('sends the device when given and none otherwise', async () => {
    const withDevice = scenario([state('done')]);
    await invoke(['enroll', 'start', '--student', '123', '--device', 'd9'], {
      fetch: withDevice.fetch,
    });
    expect(withDevice.calls.find((c) => c.method === 'POST')?.body).toEqual({
      deviceId: 'd9',
    });
    const without = scenario([state('done')]);
    await invoke(['enroll', 'start', '--student', '123'], {
      fetch: without.fetch,
    });
    expect(without.calls.find((c) => c.method === 'POST')?.body).toEqual({});
  });

  it('exits 1 with the reason on failed, expired and cancelled', async () => {
    const failed = await invoke(['enroll', 'start', '--student', '123'], {
      fetch: scenario([state('failed', 'processing', 'FINGERS_MISMATCH')])
        .fetch,
    });
    expect(failed.code).toBe(1);
    expect(failed.out).toContain('Failed: FINGERS_MISMATCH');
    const expired = await invoke(['enroll', 'start', '--student', '123'], {
      fetch: scenario([state('in_progress'), state('expired')]).fetch,
    });
    expect(expired.code).toBe(1);
    expect(expired.out).toContain('Expired');
    const cancelled = await invoke(['enroll', 'start', '--student', '123'], {
      fetch: scenario([state('cancelled')]).fetch,
    });
    expect(cancelled.code).toBe(1);
    expect(cancelled.out).toContain('Cancelled');
  });

  it('explains unknown and inactive students without enrolling', async () => {
    const server = scenario([]);
    const unknown = await invoke(['enroll', 'start', '--student', '000'], {
      fetch: server.fetch,
    });
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('No student with document 000');
    const inactive = await invoke(['enroll', 'start', '--student', '999'], {
      fetch: server.fetch,
    });
    expect(inactive.code).toBe(1);
    expect(inactive.err).toContain('inactive');
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('explains a busy or unavailable device without waiting', async () => {
    const server = scenario([], (call) =>
      call.method === 'POST'
        ? {
            status: 409,
            body: { message: 'Device esp32 is busy with another enrollment' },
          }
        : undefined,
    );
    const { code, err, out } = await invoke(
      ['enroll', 'start', '--student', '123'],
      { fetch: server.fetch },
    );
    expect(code).toBe(1);
    expect(err).toContain('was not started');
    expect(err).toContain('busy');
    expect(out).toBe('');
    expect(
      server.calls.filter((c) => c.method === 'GET' && c.path !== '/students'),
    ).toHaveLength(0);
  });

  it('tells how to record the consent when the server requires it', async () => {
    const server = scenario([], (call) =>
      call.method === 'POST'
        ? {
            status: 409,
            body: { code: 'CONSENT_REQUIRED', message: 'Falta consentimiento' },
          }
        : undefined,
    );
    const { code, err } = await invoke(
      ['enroll', 'start', '--student', '123'],
      {
        fetch: server.fetch,
      },
    );
    expect(code).toBe(1);
    expect(err).toContain('no recorded consent');
    expect(err).toContain('gym student edit 123 --consented');
  });

  it('cancels the open enrollment on Ctrl+C and exits non-zero', async () => {
    const controller = new AbortController();
    const server = scenario([state('in_progress', 'place_finger')]);
    const { code, out } = await invoke(
      ['enroll', 'start', '--student', '123'],
      {
        fetch: server.fetch,
        signal: controller.signal,
        sleep: async () => controller.abort(),
      },
    );
    expect(code).toBe(130);
    expect(server.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/enrollments/eid/cancel',
    });
    expect(out).toContain('Cancelled');
  });

  it('shows the real end state when it finished before the cancel', async () => {
    const controller = new AbortController();
    const server = scenario([state('done')], (call) =>
      call.path.endsWith('/cancel')
        ? { status: 409, body: { message: 'finished' } }
        : undefined,
    );
    // Pending -> aborted during the first sleep; GET then reports done.
    const { code, out } = await invoke(
      ['enroll', 'start', '--student', '123'],
      {
        fetch: server.fetch,
        signal: controller.signal,
        sleep: async () => controller.abort(),
      },
    );
    expect(code).toBe(0);
    expect(out).toContain('Done');
  });

  it('retries transient network errors but aborts after several', async () => {
    let gets = 0;
    const flaky = fakeServer((call) => {
      if (call.path === '/students') return { body: [ana] };
      if (call.method === 'POST')
        return { status: 201, body: state('pending') };
      return { body: state('done') };
    });
    const failing = async (...args: Parameters<typeof flaky.fetch>) => {
      if (
        args[1].method === 'GET' &&
        args[0].includes('/enrollments/') &&
        gets++ < 2
      ) {
        throw new Error('reset');
      }
      return flaky.fetch(...args);
    };
    expect(
      (
        await invoke(['enroll', 'start', '--student', '123'], {
          fetch: failing,
        })
      ).code,
    ).toBe(0);

    const dead = async (...args: Parameters<typeof flaky.fetch>) => {
      if (args[0].includes('/enrollments/')) throw new Error('down');
      return flaky.fetch(...args);
    };
    const result = await invoke(['enroll', 'start', '--student', '123'], {
      fetch: dead,
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain('Could not connect');
  });

  it('gives up when the server never reports an end state', async () => {
    let now = Date.now();
    const server = scenario([state('in_progress')]);
    const { code, err } = await invoke(
      ['enroll', 'start', '--student', '123'],
      {
        fetch: server.fetch,
        now: () => (now += 20_000),
      },
    );
    expect(code).toBe(1);
    expect(err).toContain('Gave up waiting');
    // Before the deadline it never reached a hundred polls.
    expect(server.calls.length).toBeLessThan(20);
  });

  it('requires --student', async () => {
    expect((await invoke(['enroll', 'start'])).code).toBe(2);
  });
});

describe('enroll cancel', () => {
  it('cancels by enrollment id and prints the final state', async () => {
    const server = fakeServer(() => ({ body: state('cancelled') }));
    const { code, out } = await invoke(['enroll', 'cancel', 'eid'], {
      fetch: server.fetch,
    });
    expect(code).toBe(0);
    expect(server.calls[0]).toMatchObject({
      method: 'POST',
      path: '/enrollments/eid/cancel',
    });
    expect(out).toContain('Cancelled');
  });

  it('reports a finished or unknown enrollment', async () => {
    const server = fakeServer(() => ({
      status: 409,
      body: { message: 'Enrollment already finished' },
    }));
    const { code, err } = await invoke(['enroll', 'cancel', 'eid'], {
      fetch: server.fetch,
    });
    expect(code).toBe(1);
    expect(err).toContain('already finished');
  });

  it('requires exactly one id', async () => {
    expect((await invoke(['enroll', 'cancel'])).code).toBe(2);
  });
});
