import { Logger } from '@nestjs/common';
import { parseServerMessage, type ServerMessage } from '@gymtime/shared';
import type {
  OutboundSender,
  SendResult,
} from '../devices/outbound-sender.service.js';
import { validTemplate } from '../fingerprints/testing.js';
import { NoDeviceOnlineError, SyncService } from './sync.service.js';
import { buildSyncFixture } from './testing.js';

/** Fake reader link: records messages and the peak of simultaneous sends. */
function fakeSender(
  behaviour: (message: ServerMessage, call: number) => SendResult = () =>
    'acked',
) {
  const sent: ServerMessage[] = [];
  let inFlight = 0;
  let peak = 0;
  const send = vi.fn(async (_deviceId: string, message: ServerMessage) => {
    const call = sent.push(message);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    return behaviour(message, call);
  });
  return {
    sender: { send } as unknown as OutboundSender,
    sent,
    send,
    peak: () => peak,
  };
}

async function build(behaviour?: Parameters<typeof fakeSender>[0]) {
  const f = buildSyncFixture();
  const link = fakeSender(behaviour);
  await f.devices.markOnline('d1', 'fw');
  const service = new SyncService(
    f.planner,
    f.slots,
    link.sender,
    f.devices,
    f.students,
    f.clock,
    f.config,
  );
  /** A schedule in progress with `n` enrolled students. */
  const withStudents = async (n: number) => {
    const s = await f.weekly('Now', '08:30', '09:30');
    const students = [];
    for (let i = 0; i < n; i++) {
      students.push(await f.enroll(`s${i}`, (i % 200) + 1, [s.schedule.id]));
    }
    return { schedule: s.schedule, students };
  };
  return { f, link, service, withStudents };
}

const chunksOf = (sent: ServerMessage[]) =>
  sent.filter((m) => m.type === 'templates.sync');

describe('SyncService chunks (R14, R15)', () => {
  it('sends 25 templates in 3 sequential chunks with a common syncId, all valid', async () => {
    const { service, link, withStudents } = await build();
    await withStudents(25);
    const result = await service.syncOnline();
    expect(result).toMatchObject({
      status: 'ok',
      templates: 25,
      chunks: 3,
      deviceId: 'd1',
    });

    const chunks = chunksOf(link.sent);
    expect(chunks).toHaveLength(3);
    for (const message of link.sent) {
      expect(parseServerMessage(JSON.stringify(message))).toMatchObject({
        ok: true,
      });
    }
    const payloads = chunks.map(
      (m) =>
        m.payload as {
          syncId: string;
          chunk: { index: number; total: number };
          templates: { slot: number }[];
        },
    );
    expect(new Set(payloads.map((p) => p.syncId))).toEqual(
      new Set([result.syncId]),
    );
    expect(payloads.map((p) => p.chunk)).toEqual([
      { index: 1, total: 3 },
      { index: 2, total: 3 },
      { index: 3, total: 3 },
    ]);
    expect(payloads.map((p) => p.templates.length)).toEqual([10, 10, 5]);
    expect(payloads.flatMap((p) => p.templates.map((t) => t.slot))).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(link.peak()).toBe(1); // each chunk waited for the previous ack
  });

  it('stores the slot map before sending the first chunk', async () => {
    const { f, link, service, withStudents } = await build();
    const { students } = await withStudents(2);
    link.send.mockImplementationOnce(async () => {
      expect(await f.slots.findStudentIdBySlot('d1', 2)).toBe(students[1].id);
      return 'acked';
    });
    await service.syncOnline();
    expect(f.slots.syncIds.get('d1')).toBeDefined();
  });

  it('sends one empty chunk when nobody has to be loaded', async () => {
    const { service, link } = await build();
    const result = await service.syncOnline();
    expect(result).toMatchObject({
      status: 'ok',
      templates: 0,
      chunks: 1,
      scheduleId: null,
    });
    expect(link.sent).toHaveLength(1);
    expect(link.sent[0].payload).toMatchObject({
      chunk: { index: 1, total: 1 },
      templates: [],
    });
    expect(parseServerMessage(JSON.stringify(link.sent[0]))).toMatchObject({
      ok: true,
    });
  });

  it('retries a failed chunk with the same id and then continues', async () => {
    let failures = 1;
    const { service, link, withStudents } = await build((m) =>
      m.type === 'templates.sync' && failures-- > 0 ? 'failed' : 'acked',
    );
    await withStudents(12);
    const result = await service.syncOnline();
    expect(result).toMatchObject({ status: 'ok', chunks: 2 });
    const chunks = chunksOf(link.sent);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].id).toBe(chunks[1].id);
    expect(chunks[2].id).not.toBe(chunks[0].id);
  });

  it('aborts after the bounded retries, marking the sync failed', async () => {
    const { f, service, link, withStudents } = await build((m, call) =>
      m.type === 'templates.sync' && call > 1 ? 'failed' : 'acked',
    );
    await withStudents(25);
    const result = await service.syncOnline();
    expect(result).toMatchObject({
      status: 'failed',
      error: 'CHUNK_FAILED',
      chunks: 1,
      templates: 10,
    });
    // chunk 1 once + chunk 2 three times (1 + 2 retries); nothing after, no schedule.set
    expect(link.sent).toHaveLength(4);
    expect(link.sent.some((m) => m.type === 'schedule.set')).toBe(false);
    // the intended map is kept; the next sync fixes it
    expect(await f.slots.findStudentIdBySlot('d1', 25)).not.toBeNull();
  });
});

describe('SyncService schedule.set (R16)', () => {
  it('sends the schedule of the occurrence in progress after the last chunk', async () => {
    const { service, link, withStudents } = await build();
    const { schedule } = await withStudents(1);
    await service.syncOnline();
    expect(link.sent.map((m) => m.type)).toEqual([
      'templates.sync',
      'schedule.set',
    ]);
    expect(link.sent[1].payload).toEqual({
      scheduleId: schedule.id,
      start: Date.parse('2026-11-02T13:30:00Z') / 1000,
      end: Date.parse('2026-11-02T14:30:00Z') / 1000,
      entryOpensAt: Date.parse('2026-11-02T13:20:00Z') / 1000,
      entryClosesAt: Date.parse('2026-11-02T14:25:00Z') / 1000,
    });
  });

  it('does not send it when no schedule is relevant', async () => {
    const { service, link } = await build();
    await service.syncOnline();
    expect(link.sent.map((m) => m.type)).toEqual(['templates.sync']);
  });

  it('keeps the sync ok when schedule.set is not confirmed', async () => {
    const { service, withStudents } = await build((m) =>
      m.type === 'schedule.set' ? 'failed' : 'acked',
    );
    await withStudents(1);
    expect(await service.syncOnline()).toMatchObject({
      status: 'ok',
      templates: 1,
    });
  });
});

describe('SyncService serialization and triggers (R18, R19)', () => {
  it('runs one sync at a time and merges requests made meanwhile into one more', async () => {
    const { f, service, link, withStudents } = await build();
    await withStudents(1);
    const planner = vi.spyOn(f.planner, 'build');
    const first = service.requestSync('connected', 'd1');
    await new Promise((resolve) => setTimeout(resolve, 0)); // first one is running
    const second = service.requestSync('enrollment', 'd1');
    const third = service.requestSync('manual', 'd1');
    const results = await Promise.all([first, second, third]);
    expect(link.peak()).toBe(1);
    // 'connected' ran alone; the other two shared a single later run
    expect(planner).toHaveBeenCalledTimes(2);
    expect(results[1]?.syncId).toBe(results[2]?.syncId);
    expect(results[0]?.syncId).not.toBe(results[1]?.syncId);
    expect(chunksOf(link.sent)).toHaveLength(2);
  });

  it('merges requests made in the same instant into one run', async () => {
    const { f, service } = await build();
    const planner = vi.spyOn(f.planner, 'build');
    await Promise.all([
      service.requestSync('connected', 'd1'),
      service.requestSync('enrollment', 'd1'),
    ]);
    expect(planner).toHaveBeenCalledTimes(1);
  });

  it('skips automatic triggers without a device and answers 409-style on demand', async () => {
    const { f, service, link } = await build();
    await f.devices.markOffline('d1');
    await expect(service.requestSync('before_start')).resolves.toBeNull();
    await expect(service.syncOnline()).rejects.toBeInstanceOf(
      NoDeviceOnlineError,
    );
    expect(link.send).not.toHaveBeenCalled();
  });

  it('resolves the online device for automatic triggers', async () => {
    const { service } = await build();
    expect(await service.requestSync('after_end')).toMatchObject({
      deviceId: 'd1',
      status: 'ok',
    });
  });

  it('reports PLAN_FAILED instead of rejecting when planning breaks', async () => {
    const { f, service } = await build();
    vi.spyOn(f.planner, 'build').mockRejectedValueOnce(new Error('db down'));
    expect(await service.syncOnline()).toMatchObject({
      status: 'failed',
      error: 'PLAN_FAILED',
    });
  });
});

describe('SyncService extension points (R20)', () => {
  it('uses a registered open-sessions provider', async () => {
    const { f, service, link } = await build();
    const lingering = await f.enroll('99', 9);
    service.setOpenSessionsProvider({
      listStudentIds: async () => [lingering.id],
    });
    await service.syncOnline();
    const [chunk] = chunksOf(link.sent);
    expect((chunk.payload as { templates: unknown[] }).templates).toHaveLength(
      1,
    );
  });

  it('answers the student of a slot from the last sync', async () => {
    const { service, withStudents } = await build();
    const { students } = await withStudents(2);
    await service.syncOnline();
    expect((await service.findStudentBySlot('d1', 2))?.id).toBe(students[1].id);
    expect(await service.findStudentBySlot('d1', 3)).toBeNull();
    expect(await service.findStudentBySlot('other', 1)).toBeNull();
  });
});

describe('SyncService logs (R13)', () => {
  it('never writes templates, in any encoding, to the logs', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) =>
      void lines.push(JSON.stringify(args));
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(capture);
    }
    const { f, service, withStudents } = await build();
    const { students } = await withStudents(3);
    await f.students.deactivate(students[2].id);
    await service.syncOnline();

    const output = lines.join('\n');
    expect(output).toContain('sync_done');
    for (const fill of [1, 2, 3]) {
      const bytes = Buffer.from(validTemplate(fill), 'base64');
      expect(output).not.toContain(bytes.toString('base64'));
      expect(output).not.toContain(bytes.toString('hex'));
    }
    vi.restoreAllMocks();
  });
});
