/** One reader slot and the fingerprint (and student) loaded in it. */
export interface SlotAssignment {
  slot: number;
  fingerprintId: string;
  studentId: string;
}

export interface SlotsRepository {
  /** Atomically replaces every slot of the device with the new map. */
  replace(
    deviceId: string,
    syncId: string,
    slots: SlotAssignment[],
  ): Promise<void>;
  findByDevice(deviceId: string): Promise<SlotAssignment[]>;
  /** Student whose fingerprint is loaded in the slot, or null. */
  findStudentIdBySlot(deviceId: string, slot: number): Promise<string | null>;
}

export const SLOTS_REPOSITORY = Symbol('SLOTS_REPOSITORY');
