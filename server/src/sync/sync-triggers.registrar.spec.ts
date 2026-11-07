import { SyncTriggersRegistrar } from './sync-triggers.registrar.js';
import {
  buildEnrollmentFixture,
  validTemplate,
} from '../fingerprints/testing.js';
import type { SyncService } from './sync.service.js';

describe('SyncTriggersRegistrar (R17)', () => {
  it('syncs when a device connects and when an enrollment completes', async () => {
    const fx = buildEnrollmentFixture();
    await fx.devices.markOnline('d1', 'fw');
    const requestSync = vi.fn().mockResolvedValue(null);
    new SyncTriggersRegistrar(
      fx.devices,
      fx.service,
      { requestSync } as unknown as SyncService,
      fx.students,
    ).onModuleInit();

    await fx.devices.notifyConnected('d1');
    expect(requestSync).toHaveBeenLastCalledWith('connected', 'd1');

    const student = await fx.newStudent();
    const enrollment = await fx.service.start(student.id);
    await fx.service.handleDone('d1', enrollment.id, validTemplate());
    expect(requestSync).toHaveBeenLastCalledWith('enrollment', 'd1');
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('does not hold the caller while the sync runs', async () => {
    const fx = buildEnrollmentFixture();
    const never = new Promise<null>(() => undefined);
    new SyncTriggersRegistrar(
      fx.devices,
      fx.service,
      { requestSync: () => never } as unknown as SyncService,
      fx.students,
    ).onModuleInit();
    await expect(fx.devices.notifyConnected('d1')).resolves.toBeUndefined();
  });

  it('syncs the reader after an erasure (H11)', async () => {
    const fx = buildEnrollmentFixture();
    const requestSync = vi.fn().mockResolvedValue(null);
    new SyncTriggersRegistrar(
      fx.devices,
      fx.service,
      { requestSync } as unknown as SyncService,
      fx.students,
    ).onModuleInit();
    const student = await fx.newStudent();
    await fx.students.erase(student.id, null);
    expect(requestSync).toHaveBeenCalledWith('erasure');
  });
});
