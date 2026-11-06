import { randomUUID } from 'node:crypto';
import { SystemEventsService } from '../common/events/system-events.service.js';
import type { DeviceMessage } from '@gymtime/shared';
import type { MessageProcessor } from '../devices/message-processor.service.js';
import type { OutboundSender } from '../devices/outbound-sender.service.js';
import type { OpenSessionsProvider } from '../sync/domain/open-sessions.provider.js';
import type { InstancesService } from '../schedules/instances.service.js';
import type { SyncService } from '../sync/sync.service.js';
import { AttendanceEventsRegistrar } from './attendance-events.registrar.js';
import type { AttendanceService } from './attendance.service.js';

type Handler = (
  deviceId: string,
  message: DeviceMessage,
) => Promise<void> | void;

const at = new Date('2026-11-02T15:30:00Z');
const student = {
  id: 's1',
  document: '1',
  name: 'Ana',
  program: null,
  email: null,
  phone: null,
  displayName: 'Ana',
  active: true,
  consented: true,
};

function build() {
  const handlers = new Map<string, Handler>();
  const processor = {
    registerHandler: (type: string, handler: Handler) =>
      handlers.set(type, handler),
  } as unknown as MessageProcessor;
  let provider: OpenSessionsProvider | null = null;
  const sync = {
    setOpenSessionsProvider: (value: OpenSessionsProvider) => {
      provider = value;
    },
  } as unknown as SyncService;
  const attendance = {
    recordScan: vi.fn(),
    recordUnknown: vi.fn(),
    recordButton: vi.fn(),
    listOpenStudentIds: vi.fn().mockResolvedValue(['s1']),
  } as unknown as AttendanceService;
  const send = vi.fn().mockResolvedValue('acked');
  const sender = { send } as unknown as OutboundSender;
  const events = new SystemEventsService();
  const registrar = new AttendanceEventsRegistrar(
    processor,
    sync,
    attendance,
    sender,
    events,
    { addHistoryProbe: vi.fn() } as unknown as InstancesService,
    { cols: 16, rows: 2, resultSeconds: 3 },
  );
  registrar.onModuleInit();
  return { handlers, provider: () => provider, attendance, send, events };
}

const scanMessage = (slot = 5): DeviceMessage => ({
  v: 1,
  id: randomUUID(),
  type: 'fingerprint.scan',
  ts: 111,
  ref: null,
  payload: { slot, confidence: 90 },
});

const randomMessage = (
  type: 'fingerprint.unknown' | 'button.pressed',
): DeviceMessage =>
  type === 'fingerprint.unknown'
    ? { v: 1, id: randomUUID(), type, ts: 111, ref: null, payload: {} }
    : { v: 1, id: randomUUID(), type, ts: 111, ref: null, payload: {} };

describe('AttendanceEventsRegistrar (R11, R12, R17)', () => {
  it('registers the three device handlers and the open-sessions provider', async () => {
    const { handlers, provider, attendance } = build();
    expect([...handlers.keys()].sort()).toEqual([
      'button.pressed',
      'fingerprint.scan',
      'fingerprint.unknown',
    ]);
    expect(provider()).not.toBeNull();
    expect(await provider()?.listStudentIds()).toEqual(['s1']);
    expect(attendance.listOpenStudentIds).toHaveBeenCalled();
  });

  it('decides a scan and sends the scan.result with the scan id as ref', async () => {
    const { handlers, attendance, send } = build();
    const message = scanMessage();
    attendance.recordScan = vi.fn().mockResolvedValue({
      student,
      decision: { kind: 'entry', occurrence: {} },
      at,
    });

    await handlers.get('fingerprint.scan')?.('dev', message);

    expect(attendance.recordScan).toHaveBeenCalledWith('dev', 5, 111);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('dev');
    expect(send.mock.calls[0][1]).toMatchObject({
      type: 'scan.result',
      ref: message.id,
      payload: { result: 'entry', studentName: 'Ana' },
    });
  });

  it('emits a scan event with device, slot, result and student (R13)', async () => {
    const { handlers, attendance, events } = build();
    const received: unknown[] = [];
    events.events.subscribe((event) => received.push(event));
    attendance.recordScan = vi.fn().mockResolvedValue({
      student,
      decision: { kind: 'denied', reason: 'ALREADY_EXITED' },
      at,
    });

    await handlers.get('fingerprint.scan')?.('dev', scanMessage(7));

    expect(received).toEqual([
      {
        type: 'scan',
        at: at.toISOString(),
        data: {
          deviceId: 'dev',
          slot: 7,
          result: 'denied',
          studentId: 's1',
          studentName: 'Ana',
          reason: 'ALREADY_EXITED',
        },
      },
    ]);
  });

  it('emits an unknown scan without student (R13)', async () => {
    const { handlers, attendance, events } = build();
    const received: unknown[] = [];
    events.events.subscribe((event) => received.push(event));
    attendance.recordUnknown = vi.fn().mockReturnValue(at);

    await handlers.get('fingerprint.unknown')?.(
      'dev',
      randomMessage('fingerprint.unknown'),
    );

    expect(received).toEqual([
      {
        type: 'scan',
        at: at.toISOString(),
        data: {
          deviceId: 'dev',
          slot: null,
          result: 'unknown',
          studentId: null,
          studentName: null,
          reason: null,
        },
      },
    ]);
  });

  it('answers an unknown fingerprint with `unknown` (R11)', async () => {
    const { handlers, attendance, send } = build();
    const message = randomMessage('fingerprint.unknown');
    attendance.recordUnknown = vi.fn().mockReturnValue(at);

    await handlers.get('fingerprint.unknown')?.('dev', message);

    expect(attendance.recordUnknown).toHaveBeenCalledWith('dev');
    expect(send.mock.calls[0][1]).toMatchObject({
      type: 'scan.result',
      ref: message.id,
      payload: {
        result: 'unknown',
        display: { line1: 'No reconocida', line2: 'Intente de nuevo' },
      },
    });
  });

  it('only records a button press (R12)', async () => {
    const { handlers, attendance, send } = build();
    await handlers.get('button.pressed')?.(
      'dev',
      randomMessage('button.pressed'),
    );
    expect(attendance.recordButton).toHaveBeenCalledWith('dev');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not wait for the scan.result ack before returning', async () => {
    const { handlers, attendance, send } = build();
    attendance.recordScan = vi.fn().mockResolvedValue({
      student,
      decision: { kind: 'entry', occurrence: {} },
      at,
    });
    send.mockReturnValue(new Promise(() => undefined));

    await expect(
      handlers.get('fingerprint.scan')?.('dev', scanMessage()),
    ).resolves.toBeUndefined();
  });
});
