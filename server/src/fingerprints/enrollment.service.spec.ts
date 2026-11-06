import { EnrollmentError } from './enrollment.errors.js';
import { defaultFingerprintsConfig } from './fingerprints.config.js';
import { buildEnrollmentFixture, validTemplate } from './testing.js';

async function started() {
  const fx = buildEnrollmentFixture();
  await fx.devices.markOnline('d1', '1.0.0');
  const student = await fx.newStudent();
  const enrollment = await fx.service.start(student.id);
  return { ...fx, student, enrollment };
}

const sentTypes = (send: { mock: { calls: unknown[][] } }) =>
  send.mock.calls.map((call) => (call[1] as { type: string }).type);

describe('EnrollmentService.start', () => {
  it('creates the enrollment, sends enroll.start and goes in_progress on ack', async () => {
    const { enrollment, send, student } = await started();
    expect(enrollment).toMatchObject({
      status: 'in_progress',
      studentId: student.id,
      deviceId: 'd1',
    });
    expect(send).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        type: 'enroll.start',
        payload: {
          enrollmentId: enrollment.id,
          scratchSlot: defaultFingerprintsConfig.enrollSlot,
          timeoutSec: defaultFingerprintsConfig.enrollTimeoutSec,
        },
      }),
    );
    expect(enrollment.expiresAt.getTime()).toBeGreaterThan(
      new Date('2026-01-01T00:01:00Z').getTime(),
    );
  });

  it('fails the enrollment when the device does not ack', async () => {
    const fx = buildEnrollmentFixture('failed');
    await fx.devices.markOnline('d1', '1.0.0');
    const student = await fx.newStudent();
    await expect(fx.service.start(student.id)).rejects.toMatchObject({
      code: 'DEVICE_UNAVAILABLE',
    });
    expect(await fx.enrollments.findOpenByDevice('d1')).toHaveLength(0);
  });

  it('rejects when no device is online, without creating anything', async () => {
    const fx = buildEnrollmentFixture();
    const student = await fx.newStudent();
    await expect(fx.service.start(student.id)).rejects.toMatchObject({
      code: 'DEVICE_UNAVAILABLE',
    });
    expect(fx.send).not.toHaveBeenCalled();
  });

  it('accepts an explicit deviceId', async () => {
    const fx = buildEnrollmentFixture();
    const student = await fx.newStudent();
    const enrollment = await fx.service.start(student.id, 'esp32-9');
    expect(enrollment.deviceId).toBe('esp32-9');
  });

  it('rejects unknown and inactive students', async () => {
    const fx = await started();
    await expect(fx.service.start(crypto.randomUUID())).rejects.toMatchObject({
      code: 'STUDENT_NOT_FOUND',
    });
    const other = await fx.newStudent('200');
    await fx.students.deactivate(other.id);
    await expect(fx.service.start(other.id)).rejects.toMatchObject({
      code: 'STUDENT_INACTIVE',
    });
  });

  it('rejects a second open enrollment on the same device (409)', async () => {
    const fx = await started();
    const other = await fx.newStudent('200');
    await expect(fx.service.start(other.id)).rejects.toMatchObject({
      code: 'DEVICE_BUSY',
    });
  });

  it('serializes two simultaneous starts: only one wins', async () => {
    const fx = buildEnrollmentFixture();
    await fx.devices.markOnline('d1', '1.0.0');
    const a = await fx.newStudent('1');
    const b = await fx.newStudent('2');
    const results = await Promise.allSettled([
      fx.service.start(a.id),
      fx.service.start(b.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await fx.enrollments.findOpenByDevice('d1')).toHaveLength(1);
  });

  it('allows a new enrollment once the previous one is terminal', async () => {
    const fx = await started();
    await fx.service.cancel(fx.enrollment.id);
    const other = await fx.newStudent('200');
    await expect(fx.service.start(other.id)).resolves.toMatchObject({
      status: 'in_progress',
    });
  });
});

describe('EnrollmentService events', () => {
  it('records the last progress step', async () => {
    const fx = await started();
    await fx.service.handleProgress('d1', fx.enrollment.id, 'place_again');
    expect(await fx.service.get(fx.enrollment.id)).toMatchObject({
      status: 'in_progress',
      step: 'place_again',
    });
  });

  it('stores the encrypted template on done and finishes', async () => {
    const fx = await started();
    const template = validTemplate();
    await fx.service.handleDone('d1', fx.enrollment.id, template);
    expect((await fx.service.get(fx.enrollment.id)).status).toBe('done');
    const stored = await fx.fingerprints.findActiveByStudent(fx.student.id);
    expect(stored?.template.toString('base64')).not.toContain(template);
    expect(
      fx.cipher
        .decrypt({ data: stored!.template, iv: stored!.iv })
        .toString('base64'),
    ).toBe(template);
  });

  it('notifies the completed listeners once, surviving a failing one (R17)', async () => {
    const fx = await started();
    const events: unknown[] = [];
    fx.service.onCompleted(() => {
      throw new Error('boom');
    });
    fx.service.onCompleted((event) => {
      events.push(event);
    });
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate());
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate());
    expect(events).toEqual([
      {
        deviceId: 'd1',
        studentId: fx.student.id,
        enrollmentId: fx.enrollment.id,
      },
    ]);
  });

  it('does not notify when the template is rejected', async () => {
    const fx = await started();
    const listener = vi.fn();
    fx.service.onCompleted(listener);
    await fx.service.handleDone('d1', fx.enrollment.id, 'AAAA');
    expect(listener).not.toHaveBeenCalled();
  });

  it('fails the enrollment with the reason when the template is invalid', async () => {
    const fx = await started();
    await fx.service.handleDone('d1', fx.enrollment.id, 'AAAA');
    expect(await fx.service.get(fx.enrollment.id)).toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('BAD_SIZE'),
    });
    expect(fx.fingerprints.all()).toHaveLength(0);
  });

  it('keeps the failure reason sent by the device', async () => {
    const fx = await started();
    await fx.service.handleFailed('d1', fx.enrollment.id, 'FINGERS_MISMATCH');
    expect(await fx.service.get(fx.enrollment.id)).toMatchObject({
      status: 'failed',
      failureReason: 'FINGERS_MISMATCH',
    });
  });

  it('re-enrolling erases the previous fingerprint: one row, none inactive', async () => {
    const fx = await started();
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate(1));
    const second = await fx.service.start(fx.student.id);
    await fx.service.handleDone('d1', second.id, validTemplate(2));
    const rows = fx.fingerprints.all();
    expect(rows).toHaveLength(1);
    expect(rows.every((f) => f.active)).toBe(true);
    const active = await fx.fingerprints.findActiveByStudent(fx.student.id);
    expect(
      fx.cipher.decrypt({ data: active!.template, iv: active!.iv })[0],
    ).toBe(2);
  });

  it('ignores events for unknown, finished or foreign-device enrollments', async () => {
    const fx = await started();
    await fx.service.handleDone('d1', crypto.randomUUID(), validTemplate());
    await fx.service.handleDone('other', fx.enrollment.id, validTemplate());
    expect((await fx.service.get(fx.enrollment.id)).status).toBe('in_progress');
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate());
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate(9));
    // A repeated done is a no-op: it must not erase the stored fingerprint.
    await fx.service.handleFailed('d1', fx.enrollment.id, 'late');
    await fx.service.handleProgress('d1', fx.enrollment.id, 'processing');
    expect(await fx.service.get(fx.enrollment.id)).toMatchObject({
      status: 'done',
      failureReason: null,
    });
    expect(fx.fingerprints.all()).toHaveLength(1);
  });
});

describe('EnrollmentService cancel and expiry', () => {
  it('cancels an open enrollment and tells the device', async () => {
    const fx = await started();
    const cancelled = await fx.service.cancel(fx.enrollment.id);
    expect(cancelled.status).toBe('cancelled');
    expect(sentTypes(fx.send)).toEqual(['enroll.start', 'enroll.cancel']);
  });

  it('answers conflict when cancelling a finished enrollment', async () => {
    const fx = await started();
    await fx.service.handleFailed('d1', fx.enrollment.id, 'x');
    await expect(fx.service.cancel(fx.enrollment.id)).rejects.toMatchObject({
      code: 'ENROLLMENT_FINISHED',
    });
    expect((await fx.service.get(fx.enrollment.id)).status).toBe('failed');
  });

  it('ignores events after a cancellation', async () => {
    const fx = await started();
    await fx.service.cancel(fx.enrollment.id);
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate());
    expect(fx.fingerprints.all()).toHaveLength(0);
  });

  it('expires overdue enrollments and sends enroll.cancel', async () => {
    const fx = await started();
    expect(await fx.service.expireOverdue()).toBe(0);
    fx.advance(
      (defaultFingerprintsConfig.enrollTimeoutSec +
        defaultFingerprintsConfig.ackMarginSec) *
        1000,
    );
    expect(await fx.service.expireOverdue()).toBe(1);
    expect((await fx.service.get(fx.enrollment.id)).status).toBe('expired');
    expect(sentTypes(fx.send)).toEqual(['enroll.start', 'enroll.cancel']);
    expect(await fx.service.expireOverdue()).toBe(0);
  });

  it('expires lazily on query and frees the device', async () => {
    const fx = await started();
    fx.advance(10 * 60 * 1000);
    expect((await fx.service.get(fx.enrollment.id)).status).toBe('expired');
    const other = await fx.newStudent('200');
    await expect(fx.service.start(other.id)).resolves.toBeDefined();
  });

  it('ignores a done that arrives after expiry', async () => {
    const fx = await started();
    fx.advance(10 * 60 * 1000);
    await fx.service.expireOverdue();
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate());
    expect(fx.fingerprints.all()).toHaveLength(0);
  });

  it('answers not found for unknown enrollments', async () => {
    const fx = buildEnrollmentFixture();
    const id = crypto.randomUUID();
    await expect(fx.service.get(id)).rejects.toBeInstanceOf(EnrollmentError);
    await expect(fx.service.cancel(id)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND',
    });
  });
});

describe('EnrollmentService student deactivation', () => {
  it('removes the fingerprint and cancels open enrollments', async () => {
    const fx = await started();
    await fx.service.handleDone('d1', fx.enrollment.id, validTemplate());
    const open = await fx.service.start(fx.student.id);
    await fx.service.onStudentDeactivated(fx.student);
    expect(fx.fingerprints.all()).toHaveLength(0);
    expect((await fx.service.get(open.id)).status).toBe('cancelled');
  });
});

describe('EnrollmentService audit (R22)', () => {
  it('traces start and cancel with ids only', async () => {
    const fx = await started();
    await fx.service.cancel(fx.enrollment.id);
    const traces = fx.eventLog.entries.filter((e) =>
      e.type.startsWith('enrollment.'),
    );
    expect(traces.map((e) => e.type)).toEqual([
      'enrollment.started',
      'enrollment.cancelled',
    ]);
    expect(traces[0].detail).toEqual({
      enrollmentId: fx.enrollment.id,
      studentId: fx.student.id,
      deviceId: 'd1',
    });
    expect(JSON.stringify(traces)).not.toMatch(/template|plantilla/i);
  });
});

describe('EnrollmentService live events (H8 R3)', () => {
  const collect = (fx: ReturnType<typeof buildEnrollmentFixture>) => {
    const received: Array<{ status: string; step: string | null }> = [];
    fx.events.events.subscribe((event) => {
      if (event.type === 'enrollment') received.push(event.data);
    });
    return received;
  };

  it('publishes each transition of a successful enrollment, never the template', async () => {
    const fx = buildEnrollmentFixture();
    await fx.devices.markOnline('d1', '1.0.0');
    const student = await fx.newStudent();
    const received = collect(fx);

    const enrollment = await fx.service.start(student.id);
    await fx.service.handleProgress('d1', enrollment.id, 'place_again');
    await fx.service.handleDone('d1', enrollment.id, validTemplate());

    expect(received.map((e) => e.status)).toEqual([
      'pending',
      'in_progress',
      'in_progress',
      'done',
    ]);
    expect(received[2]?.step).toBe('place_again');
    expect(JSON.stringify(received)).not.toContain(validTemplate());
    expect(received[3]).toMatchObject({
      enrollmentId: enrollment.id,
      studentId: student.id,
      deviceId: 'd1',
    });
  });

  it('publishes failure, cancellation and expiry once, and ignores lost races', async () => {
    const fx = buildEnrollmentFixture();
    await fx.devices.markOnline('d1', '1.0.0');
    const student = await fx.newStudent();
    const received = collect(fx);

    const failed = await fx.service.start(student.id);
    await fx.service.handleFailed('d1', failed.id, 'timeout');
    const cancelled = await fx.service.start(student.id);
    await fx.service.cancel(cancelled.id);
    await fx.service.handleProgress('d1', cancelled.id, 'late');
    const expired = await fx.service.start(student.id);
    fx.advance(60 * 60 * 1000);
    await fx.service.expireOverdue();

    expect(received.map((e) => e.status)).toEqual([
      'pending',
      'in_progress',
      'failed',
      'pending',
      'in_progress',
      'cancelled',
      'pending',
      'in_progress',
      'expired',
    ]);
    expect(expired.id).not.toBe(cancelled.id);
  });
});
