/**
 * Students that still have an open attendance session. The sync keeps their
 * templates loaded so they can exit even after their schedule ended.
 *
 * Attendance is not implemented yet: the default provider returns nothing and
 * the attendance module will register the real one with
 * `SyncService.setOpenSessionsProvider()`.
 */
export interface OpenSessionsProvider {
  listStudentIds(): Promise<string[]>;
}

export class EmptyOpenSessionsProvider implements OpenSessionsProvider {
  async listStudentIds(): Promise<string[]> {
    return [];
  }
}
