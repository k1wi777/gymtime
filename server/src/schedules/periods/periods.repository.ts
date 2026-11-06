import type {
  NewPeriod,
  NewServiceException,
  Period,
  ServiceException,
} from './period.js';

export interface PeriodsRepository {
  create(data: NewPeriod): Promise<Period>;
  findById(id: string): Promise<Period | null>;
  /** Oldest start first. */
  findAll(): Promise<Period[]>;
  findActive(): Promise<Period | null>;
  update(id: string, patch: Partial<NewPeriod>): Promise<Period | null>;
  /** Returns false when the period does not exist. */
  delete(id: string): Promise<boolean>;
  /** Makes `id` the only active period in one step; null if it does not exist. */
  activate(id: string): Promise<Period | null>;
  deactivate(id: string): Promise<Period | null>;

  listExceptions(periodId: string): Promise<ServiceException[]>;
  /** Exceptions of several periods, grouped by period id. */
  listExceptionsOf(
    periodIds: string[],
  ): Promise<Map<string, ServiceException[]>>;
  findException(id: string): Promise<ServiceException | null>;
  addException(data: NewServiceException): Promise<ServiceException>;
  updateException(
    id: string,
    patch: Partial<Pick<ServiceException, 'from' | 'to' | 'reason'>>,
  ): Promise<ServiceException | null>;
  removeException(id: string): Promise<boolean>;
}

export const PERIODS_REPOSITORY = Symbol('PERIODS_REPOSITORY');
