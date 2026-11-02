import { buildEnrollmentFixture, validTemplate } from './testing.js';
import { defaultFingerprintsConfig } from './fingerprints.config.js';
import { FingerprintsService } from './fingerprints.service.js';

function build() {
  const fx = buildEnrollmentFixture();
  const service = new FingerprintsService(
    fx.students,
    fx.cipher,
    fx.fingerprints,
    defaultFingerprintsConfig,
  );
  const enroll = async (document: string, fill: number) => {
    const student = await fx.newStudent(document);
    const encrypted = fx.cipher.encrypt(
      Buffer.from(validTemplate(fill), 'base64'),
    );
    fx.fingerprints.replaceActive(student.id, encrypted.data, encrypted.iv);
    return student;
  };
  return { fx, service, enroll };
}

describe('FingerprintsService.findSyncable (R9, R12, R13)', () => {
  it('decrypts the active fingerprint of active students in request order', async () => {
    const { service, enroll } = build();
    const a = await enroll('1', 1);
    const b = await enroll('2', 2);
    const { fingerprints, skippedStudentIds } = await service.findSyncable([
      b.id,
      a.id,
    ]);
    expect(skippedStudentIds).toEqual([]);
    expect(fingerprints.map((f) => f.studentId)).toEqual([b.id, a.id]);
    expect(fingerprints[0].template.toString('base64')).toBe(validTemplate(2));
  });

  it('skips inactive students, students without fingerprint and unknown ids', async () => {
    const { fx, service, enroll } = build();
    const inactive = await enroll('1', 1);
    await fx.students.deactivate(inactive.id);
    const without = await fx.newStudent('2');
    const ok = await enroll('3', 3);
    const result = await service.findSyncable([
      inactive.id,
      without.id,
      'ghost',
      ok.id,
    ]);
    expect(result.fingerprints.map((f) => f.studentId)).toEqual([ok.id]);
    expect(result.skippedStudentIds).toEqual([
      inactive.id,
      without.id,
      'ghost',
    ]);
  });

  it('skips an unreadable template instead of failing', async () => {
    const { fx, service, enroll } = build();
    const a = await enroll('1', 1);
    fx.fingerprints.replaceActive(a.id, Buffer.alloc(40), Buffer.alloc(12));
    expect(await service.findSyncable([a.id])).toEqual({
      fingerprints: [],
      skippedStudentIds: [a.id],
    });
  });

  it('keeps the enrollment work slot out of the sync capacity', () => {
    const { service } = build();
    expect(service.syncSlotCapacity).toBe(
      defaultFingerprintsConfig.enrollSlot - 1,
    );
  });

  it('returns nothing for no ids', async () => {
    const { service } = build();
    expect(await service.findSyncable([])).toEqual({
      fingerprints: [],
      skippedStudentIds: [],
    });
  });
});
