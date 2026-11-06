import { Inject, Injectable } from '@nestjs/common';
import { EventLogService } from '../../common/audit/event-log.service.js';
import { SchedulesService } from '../schedules.service.js';
import type { RegenerationResult } from '../instances.service.js';
import {
  SCHEDULES_REPOSITORY,
  type SchedulesRepository,
} from '../domain/schedules.repository.js';
import {
  PeriodError,
  rangesOverlap,
  type NewPeriod,
  type Period,
  type ServiceException,
} from './period.js';
import {
  PERIODS_REPOSITORY,
  type PeriodsRepository,
} from './periods.repository.js';

export interface PeriodDetail {
  period: Period;
  exceptions: ServiceException[];
  schedulesCount: number;
  /** Present when the call regenerated occurrences. */
  regeneration?: RegenerationResult;
}

export interface ExceptionResult {
  exception: ServiceException;
  regeneration: RegenerationResult;
}

export type PeriodPatch = Partial<NewPeriod>;
export type ExceptionInput = Pick<ServiceException, 'from' | 'to' | 'reason'>;

/**
 * Periods and their days without service (E18). Every change that can alter
 * which days a schedule occurs on regenerates the future occurrences of the
 * period's schedules, protecting the ones with attendance or alarms.
 */
@Injectable()
export class PeriodsService {
  constructor(
    @Inject(PERIODS_REPOSITORY) private readonly periods: PeriodsRepository,
    @Inject(SCHEDULES_REPOSITORY)
    private readonly schedules: SchedulesRepository,
    private readonly schedulesService: SchedulesService,
    private readonly eventLog: EventLogService,
  ) {}

  async list(): Promise<PeriodDetail[]> {
    const all = await this.periods.findAll();
    const exceptions = await this.periods.listExceptionsOf(
      all.map((p) => p.id),
    );
    return Promise.all(
      all.map(async (period) => ({
        period,
        exceptions: exceptions.get(period.id) ?? [],
        schedulesCount: (await this.schedules.findByPeriod(period.id)).length,
      })),
    );
  }

  async get(id: string): Promise<PeriodDetail> {
    return this.detail(await this.require(id));
  }

  /** @throws PeriodError INVALID_RANGE, PERIOD_OVERLAP */
  async create(input: NewPeriod): Promise<PeriodDetail> {
    this.checkRange(input.startDate, input.endDate);
    await this.checkOverlap(input.startDate, input.endDate);
    const period = await this.periods.create(input);
    await this.eventLog.record('period.created', { periodId: period.id });
    return this.detail(period);
  }

  /**
   * Changing the dates regenerates the schedules of the period.
   * @throws PeriodError PERIOD_NOT_FOUND, INVALID_RANGE, PERIOD_OVERLAP,
   * PERIOD_EXCLUDES_EXCEPTION
   */
  async update(id: string, patch: PeriodPatch): Promise<PeriodDetail> {
    const current = await this.require(id);
    const startDate = patch.startDate ?? current.startDate;
    const endDate = patch.endDate ?? current.endDate;
    this.checkRange(startDate, endDate);
    await this.checkOverlap(startDate, endDate, id);
    const exceptions = await this.periods.listExceptions(id);
    const outside = exceptions.find(
      (e) => e.from < startDate || e.to > endDate,
    );
    if (outside) {
      throw new PeriodError(
        'PERIOD_EXCLUDES_EXCEPTION',
        `El día sin servicio "${outside.reason}" (${outside.from} a ${outside.to}) quedaría fuera del periodo`,
        { exceptionId: outside.id },
      );
    }
    const period = await this.periods.update(id, patch);
    if (!period) throw notFound();
    await this.eventLog.record('period.updated', {
      periodId: id,
      fields: Object.keys(patch),
    });
    const datesChanged =
      startDate !== current.startDate || endDate !== current.endDate;
    return {
      ...(await this.detail(period)),
      ...(datesChanged && { regeneration: await this.regenerate(id) }),
    };
  }

  /** @throws PeriodError PERIOD_NOT_FOUND, PERIOD_HAS_SCHEDULES */
  async remove(id: string): Promise<void> {
    await this.require(id);
    const count = (await this.schedules.findByPeriod(id)).length;
    if (count > 0) {
      throw new PeriodError(
        'PERIOD_HAS_SCHEDULES',
        `El periodo tiene ${count} horario(s); elimínelos primero`,
        { schedulesCount: count },
      );
    }
    await this.periods.delete(id);
    await this.eventLog.record('period.deleted', { periodId: id });
  }

  /**
   * Makes this the only active period.
   * @throws PeriodError PERIOD_NOT_FOUND, PERIOD_OVERLAP
   */
  async activate(id: string): Promise<PeriodDetail> {
    const current = await this.require(id);
    await this.checkOverlap(current.startDate, current.endDate, id);
    const period = await this.periods.activate(id);
    if (!period) throw notFound();
    await this.eventLog.record('period.activated', { periodId: id });
    return this.detail(period);
  }

  async deactivate(id: string): Promise<PeriodDetail> {
    await this.require(id);
    const period = await this.periods.deactivate(id);
    if (!period) throw notFound();
    await this.eventLog.record('period.deactivated', { periodId: id });
    return this.detail(period);
  }

  /** @throws PeriodError PERIOD_NOT_FOUND, INVALID_RANGE, EXCEPTION_OUT_OF_PERIOD */
  async addException(
    periodId: string,
    input: ExceptionInput,
  ): Promise<ExceptionResult> {
    const period = await this.require(periodId);
    this.checkException(period, input);
    const exception = await this.periods.addException({ periodId, ...input });
    await this.eventLog.record('period.exception_added', {
      periodId,
      exceptionId: exception.id,
    });
    return { exception, regeneration: await this.regenerate(periodId) };
  }

  /** @throws PeriodError PERIOD_NOT_FOUND, EXCEPTION_NOT_FOUND, INVALID_RANGE, EXCEPTION_OUT_OF_PERIOD */
  async updateException(
    periodId: string,
    exceptionId: string,
    patch: Partial<ExceptionInput>,
  ): Promise<ExceptionResult> {
    const period = await this.require(periodId);
    const current = await this.requireException(periodId, exceptionId);
    this.checkException(period, { ...current, ...patch });
    const exception = await this.periods.updateException(exceptionId, patch);
    if (!exception) throw exceptionNotFound();
    await this.eventLog.record('period.exception_updated', {
      periodId,
      exceptionId,
      fields: Object.keys(patch),
    });
    return { exception, regeneration: await this.regenerate(periodId) };
  }

  /** @throws PeriodError PERIOD_NOT_FOUND, EXCEPTION_NOT_FOUND */
  async removeException(
    periodId: string,
    exceptionId: string,
  ): Promise<RegenerationResult> {
    await this.require(periodId);
    await this.requireException(periodId, exceptionId);
    await this.periods.removeException(exceptionId);
    await this.eventLog.record('period.exception_removed', {
      periodId,
      exceptionId,
    });
    return this.regenerate(periodId);
  }

  private async regenerate(periodId: string): Promise<RegenerationResult> {
    const schedules = await this.schedules.findByPeriod(periodId);
    return this.schedulesService.regenerate(schedules.map((s) => s.id));
  }

  private async detail(period: Period): Promise<PeriodDetail> {
    const [exceptions, schedules] = await Promise.all([
      this.periods.listExceptions(period.id),
      this.schedules.findByPeriod(period.id),
    ]);
    return { period, exceptions, schedulesCount: schedules.length };
  }

  private async require(id: string): Promise<Period> {
    const period = await this.periods.findById(id);
    if (!period) throw notFound();
    return period;
  }

  private async requireException(
    periodId: string,
    exceptionId: string,
  ): Promise<ServiceException> {
    const exception = await this.periods.findException(exceptionId);
    if (exception?.periodId !== periodId) throw exceptionNotFound();
    return exception;
  }

  private checkRange(from: string, to: string): void {
    if (to < from) {
      throw new PeriodError(
        'INVALID_RANGE',
        'La fecha final no puede ser anterior a la inicial',
      );
    }
  }

  /** Periods never overlap, active or not: the check runs against all of them. */
  private async checkOverlap(
    startDate: string,
    endDate: string,
    ownId?: string,
  ): Promise<void> {
    const clash = (await this.periods.findAll()).find(
      (other) =>
        other.id !== ownId &&
        rangesOverlap(
          { from: startDate, to: endDate },
          { from: other.startDate, to: other.endDate },
        ),
    );
    if (clash) {
      throw new PeriodError(
        'PERIOD_OVERLAP',
        `Las fechas se cruzan con el periodo "${clash.name}" (${clash.startDate} a ${clash.endDate})`,
        { conflictId: clash.id, conflictName: clash.name },
      );
    }
  }

  private checkException(period: Period, range: ExceptionInput): void {
    this.checkRange(range.from, range.to);
    if (range.from < period.startDate || range.to > period.endDate) {
      throw new PeriodError(
        'EXCEPTION_OUT_OF_PERIOD',
        `El rango debe estar dentro del periodo (${period.startDate} a ${period.endDate})`,
      );
    }
  }
}

const notFound = () =>
  new PeriodError('PERIOD_NOT_FOUND', 'El periodo no existe');
const exceptionNotFound = () =>
  new PeriodError('EXCEPTION_NOT_FOUND', 'El día sin servicio no existe');
