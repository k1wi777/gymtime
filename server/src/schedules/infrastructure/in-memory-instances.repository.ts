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
}
