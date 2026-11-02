import { randomUUID } from 'node:crypto';
import type { NewSchedule, Schedule } from '../domain/schedule.js';
import type { SchedulesRepository } from '../domain/schedules.repository.js';

export class InMemorySchedulesRepository implements SchedulesRepository {
  private readonly schedules = new Map<string, Schedule>();
  private readonly assignments = new Set<string>();

  async create(data: NewSchedule) {
    const schedule: Schedule = { id: randomUUID(), ...data };
    this.schedules.set(schedule.id, schedule);
    return { ...schedule };
  }

  async findById(id: string) {
    const schedule = this.schedules.get(id);
    return schedule ? { ...schedule } : null;
  }

  async findAll() {
    return [...this.schedules.values()].map((s) => ({ ...s }));
  }

  async findByStudent(studentId: string) {
    return [...this.schedules.values()]
      .filter((s) => this.assignments.has(key(s.id, studentId)))
      .map((s) => ({ ...s }));
  }

  async assignStudent(scheduleId: string, studentId: string) {
    this.assignments.add(key(scheduleId, studentId));
  }

  async unassignStudent(scheduleId: string, studentId: string) {
    this.assignments.delete(key(scheduleId, studentId));
  }

  async listStudentIds(scheduleIds: string[]) {
    const result = new Map<string, string[]>(scheduleIds.map((id) => [id, []]));
    for (const entry of this.assignments) {
      const [scheduleId, studentId] = entry.split('|');
      result.get(scheduleId)?.push(studentId);
    }
    return result;
  }
}

const key = (scheduleId: string, studentId: string) =>
  `${scheduleId}|${studentId}`;
