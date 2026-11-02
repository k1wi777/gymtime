import type { DeviceMessage } from '@gymtime/shared';
import type {
  MessageHandler,
  MessageProcessor,
} from '../devices/message-processor.service.js';
import { EnrollmentEventsRegistrar } from './enrollment-events.registrar.js';
import { buildEnrollmentFixture, validTemplate } from './testing.js';

const msg = (type: string, payload: object) =>
  ({
    v: 1,
    id: crypto.randomUUID(),
    type,
    ts: 1,
    ref: null,
    payload,
  }) as DeviceMessage;

describe('EnrollmentEventsRegistrar', () => {
  async function setup() {
    const fx = buildEnrollmentFixture();
    const handlers = new Map<string, MessageHandler>();
    const processor = {
      registerHandler: (type: string, handler: MessageHandler) =>
        handlers.set(type, handler),
    } as unknown as MessageProcessor;
    new EnrollmentEventsRegistrar(
      processor,
      fx.students,
      fx.service,
    ).onModuleInit();
    await fx.devices.markOnline('d1', '1.0.0');
    const student = await fx.newStudent();
    const enrollment = await fx.service.start(student.id);
    return { ...fx, handlers, student, enrollment };
  }

  it('registers the three enroll.* handlers', async () => {
    const { handlers } = await setup();
    expect([...handlers.keys()].sort()).toEqual([
      'enroll.done',
      'enroll.failed',
      'enroll.progress',
    ]);
  });

  it('routes progress, done and failed to the service', async () => {
    const fx = await setup();
    const enrollmentId = fx.enrollment.id;
    await fx.handlers.get('enroll.progress')!(
      'd1',
      msg('enroll.progress', { enrollmentId, step: 'processing' }),
    );
    expect((await fx.service.get(enrollmentId)).step).toBe('processing');
    await fx.handlers.get('enroll.done')!(
      'd1',
      msg('enroll.done', { enrollmentId, template: validTemplate() }),
    );
    expect((await fx.service.get(enrollmentId)).status).toBe('done');
  });

  it('routes failed and ignores events of unknown enrollments without throwing', async () => {
    const fx = await setup();
    const enrollmentId = fx.enrollment.id;
    await expect(
      fx.handlers.get('enroll.failed')!(
        'd1',
        msg('enroll.failed', {
          enrollmentId: crypto.randomUUID(),
          reason: 'x',
        }),
      ),
    ).resolves.toBeUndefined();
    await fx.handlers.get('enroll.failed')!(
      'd1',
      msg('enroll.failed', { enrollmentId, reason: 'BAD_FINGER' }),
    );
    expect((await fx.service.get(enrollmentId)).failureReason).toBe(
      'BAD_FINGER',
    );
  });

  it('cleans up after a student deactivation', async () => {
    const fx = await setup();
    await fx.students.deactivate(fx.student.id);
    expect((await fx.service.get(fx.enrollment.id)).status).toBe('cancelled');
  });
});
