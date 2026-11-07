import type { AlarmRepository } from '../../alarm/domain/alarm.repository.js';
import type { AttendanceRepository } from '../../attendance/domain/attendance.repository.js';
import { fromBogota } from '../../common/time/bogota.js';
import type { InstancesRepository } from '../../schedules/domain/instances.repository.js';
import type { SchedulesRepository } from '../../schedules/domain/schedules.repository.js';
import type { PeriodsRepository } from '../../schedules/periods/periods.repository.js';
import type { StudentsRepository } from '../../students/domain/students.repository.js';

/** Everything the report reads go through; Prisma and memory must agree (R16). */
export interface ReadRepositories {
  students: StudentsRepository;
  periods: PeriodsRepository;
  schedules: SchedulesRepository;
  instances: InstancesRepository;
  attendance: AttendanceRepository;
  alarm: AlarmRepository;
}

const at = (date: string, time: string) => fromBogota(date, time);

/**
 * Contract of the reads added for the reports. The factory returns empty
 * repositories each time; the suite writes only through their public API.
 */
export function describeReportReads(
  name: string,
  factory: () => Promise<ReadRepositories>,
) {
  describe(`report reads: ${name}`, () => {
    async function world() {
      const repos = await factory();
      const period = await repos.periods.create({
        name: 'Contrato',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      });
      const make = (n: string, weekday: number) =>
        repos.schedules.create({
          name: n,
          weekday,
          date: null,
          startTime: '06:00:00',
          endTime: '07:00:00',
          entryOpenMinutes: null,
          entryCloseMinutes: null,
          periodId: period.id,
        });
      const [mon, wed] = [await make('Lunes', 1), await make('Miércoles', 3)];
      const ana = await repos.students.create({
        document: `C-${name}-1`,
        name: 'Ana',
        program: 'X',
        email: null,
        phone: null,
        displayName: 'Ana',
      });
      const beto = await repos.students.create({
        document: `C-${name}-2`,
        name: 'Beto',
        program: null,
        email: null,
        phone: null,
        displayName: 'Beto',
      });
      const dates: [string, typeof mon][] = [
        ['2026-03-02', mon],
        ['2026-03-04', wed],
        ['2026-03-09', mon],
        ['2026-03-31', mon],
      ];
      await repos.instances.createMany(
        dates.map(([date, s]) => ({
          scheduleId: s.id,
          date,
          startsAt: at(date, '06:00'),
          endsAt: at(date, '07:00'),
        })),
      );
      const all = await repos.instances.findByDates('2026-03-01', '2026-03-31');
      return { repos, mon, wed, ana, beto, all };
    }

    it('instances.findByDates is inclusive, ordered by start and filtered by schedule', async () => {
      const { repos, mon, all } = await world();
      expect(all.map((i) => i.date)).toEqual([
        '2026-03-02',
        '2026-03-04',
        '2026-03-09',
        '2026-03-31',
      ]);
      const edges = await repos.instances.findByDates(
        '2026-03-04',
        '2026-03-09',
      );
      expect(edges.map((i) => i.date)).toEqual(['2026-03-04', '2026-03-09']);
      expect(
        (await repos.instances.findByDates('2026-03-02', '2026-03-02')).length,
      ).toBe(1);
      const only = await repos.instances.findByDates(
        '2026-03-01',
        '2026-03-31',
        [mon.id],
      );
      expect(only.map((i) => i.date)).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-31',
      ]);
      expect(
        await repos.instances.findByDates('2026-03-01', '2026-03-31', []),
      ).toEqual([]);
      expect(
        await repos.instances.findByDates('2026-04-01', '2026-04-30'),
      ).toEqual([]);
      expect(all[0]).toMatchObject({
        scheduleId: mon.id,
        startsAt: at('2026-03-02', '06:00'),
        endsAt: at('2026-03-02', '07:00'),
      });
    });

    it('schedules.listAssignmentsFor returns closed intervals too, filtered by student', async () => {
      const { repos, mon, wed, ana, beto } = await world();
      await repos.schedules.assignStudent(
        mon.id,
        ana.id,
        at('2026-03-01', '00:00'),
      );
      await repos.schedules.unassignStudent(
        mon.id,
        ana.id,
        at('2026-03-10', '06:30'),
      );
      await repos.schedules.assignStudent(
        mon.id,
        ana.id,
        at('2026-03-20', '00:00'),
      );
      await repos.schedules.assignStudent(
        mon.id,
        beto.id,
        at('2026-03-05', '00:00'),
      );
      await repos.schedules.assignStudent(
        wed.id,
        ana.id,
        at('2026-03-02', '00:00'),
      );

      const monday = await repos.schedules.listAssignmentsFor([mon.id]);
      expect(monday).toHaveLength(3);
      const starts = monday.map((a) => a.validFrom.toISOString());
      expect(starts).toEqual(starts.toSorted());
      const closed = monday.find((a) => a.validTo !== null);
      expect(closed).toMatchObject({
        studentId: ana.id,
        validTo: at('2026-03-10', '06:30'),
      });

      expect(
        await repos.schedules.listAssignmentsFor([mon.id], [beto.id]),
      ).toHaveLength(1);
      expect(
        await repos.schedules.listAssignmentsFor([mon.id, wed.id], [ana.id]),
      ).toHaveLength(3);
      expect(await repos.schedules.listAssignmentsFor([])).toEqual([]);
      expect(await repos.schedules.listAssignmentsFor([mon.id], [])).toEqual(
        [],
      );
    });

    it('alarm.findByInstanceIds returns open and closed events of those occurrences only', async () => {
      const { repos, all } = await world();
      const [i1, i2, i3] = all;
      const closed = await repos.alarm.create({
        instanceId: i1!.id,
        startedAt: at('2026-03-02', '07:00'),
      });
      await repos.alarm.close(closed.id, {
        endedAt: at('2026-03-02', '07:05'),
        closedBy: 'button',
        closedSessions: 2,
      });
      await repos.alarm.create({
        instanceId: i2!.id,
        startedAt: at('2026-03-04', '07:00'),
      });
      await repos.alarm.create({
        instanceId: i3!.id,
        startedAt: at('2026-03-09', '07:00'),
      });

      const found = await repos.alarm.findByInstanceIds([i1!.id, i2!.id]);
      expect(found.map((e) => e.instanceId)).toEqual([i1!.id, i2!.id]);
      expect(found[0]).toMatchObject({
        closedBy: 'button',
        closedSessions: 2,
        endedAt: at('2026-03-02', '07:05'),
      });
      expect(found[1]!.endedAt).toBeNull();
      expect(await repos.alarm.findByInstanceIds([])).toEqual([]);
    });

    it('a local alarm (H12) is stored once, never counts as open and keeps its origin', async () => {
      const { repos, all } = await world();
      const [i1] = all;
      const local = {
        instanceId: i1!.id,
        startedAt: at('2026-03-02', '07:00'),
        endedAt: at('2026-03-02', '07:02'),
        closedBy: 'button' as const,
        deviceId: 'esp32-1',
        deviceEventId: '00000000-0000-4000-8000-0000000000e1',
      };
      const first = await repos.alarm.createLocal(local);
      const again = await repos.alarm.createLocal(local);
      expect(first.created).toBe(true);
      expect(again).toMatchObject({
        created: false,
        event: { id: first.event.id },
      });
      expect(first.event).toMatchObject({
        origin: 'local',
        deviceId: 'esp32-1',
        endedAt: local.endedAt,
        closedBy: 'button',
      });
      expect(await repos.alarm.findOpen()).toEqual([]);
      expect(await repos.alarm.findOpenByInstance(i1!.id)).toBeNull();
      const server = await repos.alarm.create({
        instanceId: i1!.id,
        startedAt: at('2026-03-02', '07:00'),
      });
      expect(server.origin).toBe('server');
      expect((await repos.alarm.findOpenByInstance(i1!.id))?.id).toBe(
        server.id,
      );
      const found = await repos.alarm.findByInstanceIds([i1!.id]);
      expect(found.map((e) => e.origin).sort()).toEqual(['local', 'server']);
    });

    it('attendance.list by occurrences and students keeps every state and source', async () => {
      const { repos, ana, beto, all } = await world();
      const [i1, i2] = all;
      const a = await repos.attendance.create({
        studentId: ana.id,
        instanceId: i1!.id,
        enteredAt: at('2026-03-02', '06:01'),
        entrySource: 'device',
      });
      await repos.attendance.close(a.id, {
        exitedAt: at('2026-03-02', '06:50'),
        exitSource: 'manual',
        manualReason: 'prueba',
      });
      await repos.attendance.create({
        studentId: beto.id,
        instanceId: i1!.id,
        enteredAt: at('2026-03-02', '06:05'),
        entrySource: 'manual',
        manualReason: 'prueba',
      });
      await repos.attendance.create({
        studentId: ana.id,
        instanceId: i2!.id,
        enteredAt: at('2026-03-04', '06:00'),
        entrySource: 'device',
      });
      await repos.attendance.closeOpenByInstance(i2!.id, {
        manualReason: 'timeout',
      });

      const both = await repos.attendance.list({
        instanceIds: [i1!.id, i2!.id],
      });
      expect(both.map((s) => s.status)).toEqual([
        'cerrada',
        'abierta',
        'no_registrada',
      ]);
      expect(both[0]).toMatchObject({
        exitSource: 'manual',
        entrySource: 'device',
      });
      const onlyAna = await repos.attendance.list({
        instanceIds: [i1!.id, i2!.id],
        studentIds: [ana.id],
      });
      expect(onlyAna.map((s) => s.studentId)).toEqual([ana.id, ana.id]);
      expect(
        await repos.attendance.list({
          instanceIds: [i2!.id],
          studentIds: [beto.id],
        }),
      ).toEqual([]);
    });
  });
}
