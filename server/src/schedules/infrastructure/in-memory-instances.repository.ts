import { randomUUID } from 'node:crypto';
import type { InstancesRepository } from '../domain/instances.repository.js';
import type {
  NewScheduleInstance,
  ScheduleInstance,
} from '../domain/schedule-instance.js';

export class InMemoryInstancesRepository implements InstancesRepository {
  private readonly rows: ScheduleInstance[] = [];

  async createMany(items: NewScheduleInstance[]) {
    let created = 0;
    for (const item of items) {
      const exists = this.rows.some(
        (r) => r.scheduleId === item.scheduleId && r.date === item.date,
      );
      if (exists) continue;
      this.rows.push({ id: randomUUID(), status: 'scheduled', ...item });
      created++;
    }
    return created;
  }

  async findFromDate(scheduleIds: string[], fromDate: string) {
    return this.rows
      .filter((r) => scheduleIds.includes(r.scheduleId) && r.date >= fromDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r }));
  }

  async deleteByIds(ids: string[]) {
    const doomed = new Set(ids);
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (doomed.has((this.rows[i] as ScheduleInstance).id)) {
        this.rows.splice(i, 1);
      }
    }
    return before - this.rows.length;
  }

  async updateTimes(id: string, startsAt: Date, endsAt: Date) {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { startsAt, endsAt });
  }

  async findInRange(from: Date, to: Date, scheduleIds?: string[]) {
    return this.rows
      .filter(
        (r) =>
          r.startsAt <= to &&
          r.endsAt >= from &&
          (!scheduleIds || scheduleIds.includes(r.scheduleId)),
      )
      .sort(
        (a, b) =>
          a.startsAt.getTime() - b.startsAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((r) => ({ ...r }));
  }

  async findByDates(from: string, to: string, scheduleIds?: string[]) {
    return this.rows
      .filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          (!scheduleIds || scheduleIds.includes(r.scheduleId)),
      )
      .sort(
        (a, b) =>
          a.startsAt.getTime() - b.startsAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((r) => ({ ...r }));
  }

  /** Loads rows as they are (data loaders and tests); the interface cannot set ids. */
  load(rows: ScheduleInstance[]): void {
    this.rows.push(...rows.map((r) => ({ ...r })));
  }

  async findByIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.rows.filter((r) => wanted.has(r.id)).map((r) => ({ ...r }));
  }
}
