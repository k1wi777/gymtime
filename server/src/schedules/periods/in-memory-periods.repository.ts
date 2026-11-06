import { randomUUID } from 'node:crypto';
import type {
  NewPeriod,
  NewServiceException,
  Period,
  ServiceException,
} from './period.js';
import type { PeriodsRepository } from './periods.repository.js';

export class InMemoryPeriodsRepository implements PeriodsRepository {
  private readonly periods = new Map<string, Period>();
  private readonly exceptions = new Map<string, ServiceException>();

  /** Loads a period with its exceptions as they are (data loaders and tests). */
  load(period: Period, exceptions: ServiceException[] = []): void {
    this.periods.set(period.id, { ...period });
    for (const exception of exceptions) {
      this.exceptions.set(exception.id, { ...exception });
    }
  }

  async create(data: NewPeriod) {
    const period: Period = { id: randomUUID(), active: false, ...data };
    this.periods.set(period.id, period);
    return { ...period };
  }

  async findById(id: string) {
    const period = this.periods.get(id);
    return period ? { ...period } : null;
  }

  async findAll() {
    return [...this.periods.values()]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((p) => ({ ...p }));
  }

  async findActive() {
    const active = [...this.periods.values()].find((p) => p.active);
    return active ? { ...active } : null;
  }

  async update(id: string, patch: Partial<NewPeriod>) {
    const period = this.periods.get(id);
    if (!period) return null;
    const updated = { ...period, ...patch };
    this.periods.set(id, updated);
    return { ...updated };
  }

  async delete(id: string) {
    for (const [key, exception] of this.exceptions) {
      if (exception.periodId === id) this.exceptions.delete(key);
    }
    return this.periods.delete(id);
  }

  async activate(id: string) {
    if (!this.periods.has(id)) return null;
    for (const period of this.periods.values()) {
      period.active = period.id === id;
    }
    return this.findById(id);
  }

  async deactivate(id: string) {
    const period = this.periods.get(id);
    if (!period) return null;
    period.active = false;
    return { ...period };
  }

  async listExceptions(periodId: string) {
    return [...this.exceptions.values()]
      .filter((e) => e.periodId === periodId)
      .sort((a, b) => a.from.localeCompare(b.from))
      .map((e) => ({ ...e }));
  }

  async listExceptionsOf(periodIds: string[]) {
    const result = new Map<string, ServiceException[]>(
      periodIds.map((id) => [id, []]),
    );
    for (const id of periodIds) {
      result.set(id, await this.listExceptions(id));
    }
    return result;
  }

  async findException(id: string) {
    const exception = this.exceptions.get(id);
    return exception ? { ...exception } : null;
  }

  async addException(data: NewServiceException) {
    const exception: ServiceException = { id: randomUUID(), ...data };
    this.exceptions.set(exception.id, exception);
    return { ...exception };
  }

  async updateException(
    id: string,
    patch: Partial<Pick<ServiceException, 'from' | 'to' | 'reason'>>,
  ) {
    const exception = this.exceptions.get(id);
    if (!exception) return null;
    const updated = { ...exception, ...patch };
    this.exceptions.set(id, updated);
    return { ...updated };
  }

  async removeException(id: string) {
    return this.exceptions.delete(id);
  }
}
