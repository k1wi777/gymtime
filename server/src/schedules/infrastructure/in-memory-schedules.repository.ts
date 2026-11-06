import { randomUUID } from 'node:crypto';
import type { NewSchedule, Schedule } from '../domain/schedule.js';
import type {
  ScheduleAssignment,
  SchedulesRepository,
} from '../domain/schedules.repository.js';

const isActive = (assignment: ScheduleAssignment, at: Date) =>
  assignment.validFrom <= at &&
  (assignment.validTo === null || assignment.validTo > at);

export class InMemorySchedulesRepository implements SchedulesRepository {
  private readonly schedules = new Map<string, Schedule>();
  private readonly assignments: ScheduleAssignment[] = [];

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

  async findByStudent(studentId: string, at: Date) {
    return [...this.schedules.values()]
      .filter((s) =>
        this.assignments.some(
          (a) =>
            a.scheduleId === s.id &&
            a.studentId === studentId &&
            isActive(a, at),
        ),
      )
      .map((s) => ({ ...s }));
  }

  async assignStudent(scheduleId: string, studentId: string, at: Date) {
    const open = this.findOpen(scheduleId, studentId);
    if (open) return false;
    this.assignments.push({
      id: randomUUID(),
      scheduleId,
      studentId,
      validFrom: at,
      validTo: null,
    });
    return true;
  }

  async unassignStudent(scheduleId: string, studentId: string, at: Date) {
    const open = this.findOpen(scheduleId, studentId);
    if (!open) return false;
    open.validTo = at;
    return true;
  }

  async listStudentIds(scheduleIds: string[], at: Date) {
    const result = new Map<string, string[]>(scheduleIds.map((id) => [id, []]));
    for (const assignment of this.assignments) {
      if (isActive(assignment, at)) {
        result.get(assignment.scheduleId)?.push(assignment.studentId);
      }
    }
    return result;
  }

  async listAssignments(scheduleId: string) {
    return this.assignments
      .filter((a) => a.scheduleId === scheduleId)
      .map((a) => ({ ...a }));
  }

  private findOpen(scheduleId: string, studentId: string) {
    return this.assignments.find(
      (a) =>
        a.scheduleId === scheduleId &&
        a.studentId === studentId &&
        a.validTo === null,
    );
  }
}
