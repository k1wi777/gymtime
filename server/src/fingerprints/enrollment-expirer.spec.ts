import { defaultFingerprintsConfig } from './fingerprints.config.js';
import { EnrollmentExpirer } from './enrollment-expirer.js';
import { buildEnrollmentFixture } from './testing.js';

const config = { ...defaultFingerprintsConfig, expirySweepMs: 20 };

async function openEnrollment() {
  const fx = buildEnrollmentFixture();
  await fx.devices.markOnline('d1', '1.0.0');
  const student = await fx.newStudent();
  const enrollment = await fx.service.start(student.id);
  return { ...fx, enrollment };
}

describe('EnrollmentExpirer', () => {
  it('expires overdue enrollments when a sweep runs', async () => {
    const fx = await openEnrollment();
    const expirer = new EnrollmentExpirer(fx.service, config);
    await expirer.sweep();
    expect((await fx.service.get(fx.enrollment.id)).status).toBe('in_progress');
    fx.advance(10 * 60 * 1000);
    await expirer.sweep();
    expect(await fx.enrollments.findById(fx.enrollment.id)).toMatchObject({
      status: 'expired',
    });
    expect(fx.send).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ type: 'enroll.cancel' }),
    );
  });

  it('sweeps at startup and then periodically, and stops on destroy', async () => {
    const fx = await openEnrollment();
    fx.advance(10 * 60 * 1000);
    const spy = vi.spyOn(fx.service, 'expireOverdue');
    const expirer = new EnrollmentExpirer(fx.service, config);
    expirer.onModuleInit();
    await vi.waitFor(() =>
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
    expirer.onModuleDestroy();
    const calls = spy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(spy.mock.calls.length).toBe(calls);
    expect(await fx.enrollments.findById(fx.enrollment.id)).toMatchObject({
      status: 'expired',
    });
  });

  it('survives a failing sweep', async () => {
    const fx = await openEnrollment();
    vi.spyOn(fx.service, 'expireOverdue').mockRejectedValue(
      new Error('db down'),
    );
    await expect(
      new EnrollmentExpirer(fx.service, config).sweep(),
    ).resolves.toBeUndefined();
  });
});
