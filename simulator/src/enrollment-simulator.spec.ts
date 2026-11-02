import { ENROLL_STEPS, enrollDoneSchema } from '@gymtime/shared';
import {
  EnrollmentSimulator,
  type EnrollmentOptions,
} from './enrollment-simulator.js';

const ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const options = (
  patch: Partial<EnrollmentOptions> = {},
): EnrollmentOptions => ({
  mode: 'ok',
  stepMs: 100,
  failReason: 'sim_fail',
  templateBytes: 512,
  ...patch,
});

function setup(patch: Partial<EnrollmentOptions> = {}) {
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const simulator = new EnrollmentSimulator(
    (type, payload) => sent.push({ type, payload }),
    options(patch),
    (text) => logs.push(text),
  );
  return { simulator, sent, logs };
}

describe('EnrollmentSimulator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits the four steps in order and then a valid done', () => {
    const { simulator, sent } = setup();
    simulator.start({ enrollmentId: ID });
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(100 * ENROLL_STEPS.length);
    expect(sent.map((m) => m.type)).toEqual(
      ENROLL_STEPS.map(() => 'enroll.progress'),
    );
    expect(sent.map((m) => m.payload['step'])).toEqual([...ENROLL_STEPS]);
    vi.advanceTimersByTime(100);
    expect(sent.at(-1)?.type).toBe('enroll.done');
    expect(sent).toHaveLength(ENROLL_STEPS.length + 1);
    const done = sent.at(-1)!.payload;
    expect(done['enrollmentId']).toBe(ID);
    expect(Buffer.from(done['template'] as string, 'base64')).toHaveLength(512);
    expect(
      enrollDoneSchema.safeParse({
        v: 1,
        id: ID,
        type: 'enroll.done',
        ts: 1,
        ref: null,
        payload: done,
      }).success,
    ).toBe(true);
  });

  it('honours the template size and generates a different one each time', () => {
    const { simulator, sent } = setup({ templateBytes: 300 });
    for (const id of [ID, OTHER]) {
      simulator.start({ enrollmentId: id });
      vi.advanceTimersByTime(100 * 5);
    }
    const [first, second] = sent
      .filter((m) => m.type === 'enroll.done')
      .map((m) => m.payload['template'] as string);
    expect(Buffer.from(first!, 'base64')).toHaveLength(300);
    expect(first).not.toBe(second);
  });

  it('fail mode sends one step then enroll.failed with the reason, never done', () => {
    const { simulator, sent } = setup({ mode: 'fail' });
    simulator.start({ enrollmentId: ID });
    vi.advanceTimersByTime(10_000);
    expect(sent.map((m) => m.type)).toEqual([
      'enroll.progress',
      'enroll.failed',
    ]);
    expect(sent[1]?.payload).toEqual({
      enrollmentId: ID,
      reason: 'sim_fail',
    });
  });

  it('silent mode never emits anything', () => {
    const { simulator, sent, logs } = setup({ mode: 'silent' });
    simulator.start({ enrollmentId: ID });
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(0);
    expect(logs[0]).toContain('silent');
  });

  it('cancel stops the steps and emits neither done nor failed', () => {
    const { simulator, sent } = setup();
    simulator.start({ enrollmentId: ID });
    vi.advanceTimersByTime(250);
    simulator.cancel({ enrollmentId: ID });
    vi.advanceTimersByTime(10_000);
    expect(sent.map((m) => m.payload['step'])).toEqual([
      'place_finger',
      'remove_finger',
    ]);
    expect(sent.some((m) => m.type !== 'enroll.progress')).toBe(false);
  });

  it('cancelling an unknown enrollment is a no-op', () => {
    const { simulator, sent } = setup();
    simulator.start({ enrollmentId: ID });
    simulator.cancel({ enrollmentId: OTHER });
    vi.advanceTimersByTime(10_000);
    expect(sent.at(-1)?.type).toBe('enroll.done');
  });

  it('ignores a repeated start and lets a different one replace the running', () => {
    const { simulator, sent } = setup();
    simulator.start({ enrollmentId: ID });
    vi.advanceTimersByTime(100);
    simulator.start({ enrollmentId: ID });
    vi.advanceTimersByTime(100);
    expect(sent.map((m) => m.payload['step'])).toEqual([
      'place_finger',
      'remove_finger',
    ]);
    simulator.start({ enrollmentId: OTHER });
    vi.advanceTimersByTime(10_000);
    expect(sent.filter((m) => m.payload['enrollmentId'] === ID)).toHaveLength(
      2,
    );
    expect(
      sent.filter((m) => m.payload['enrollmentId'] === OTHER).at(-1)?.type,
    ).toBe('enroll.done');
  });

  it('stop drops every pending step', () => {
    const { simulator, sent } = setup();
    simulator.start({ enrollmentId: ID });
    simulator.stop();
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(0);
  });
});
