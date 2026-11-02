import type {
  SlotAssignment,
  SlotsRepository,
} from '../domain/slots.repository.js';

export class InMemorySlotsRepository implements SlotsRepository {
  private readonly byDevice = new Map<string, SlotAssignment[]>();
  readonly syncIds = new Map<string, string>();

  async replace(deviceId: string, syncId: string, slots: SlotAssignment[]) {
    this.byDevice.set(
      deviceId,
      slots.map((s) => ({ ...s })),
    );
    this.syncIds.set(deviceId, syncId);
  }

  async findByDevice(deviceId: string) {
    return (this.byDevice.get(deviceId) ?? []).map((s) => ({ ...s }));
  }

  async findStudentIdBySlot(deviceId: string, slot: number) {
    const found = this.byDevice.get(deviceId)?.find((s) => s.slot === slot);
    return found?.studentId ?? null;
  }
}
