import {
  SYSTEM_ACTOR,
  currentActor,
  deviceActor,
  runAsActor,
} from './actor.js';
import { EventLogService } from './event-log.service.js';
import { InMemoryEventLogRepository } from './in-memory-event-log.repository.js';

describe('actor context', () => {
  it('defaults to system and follows async work inside runAsActor', async () => {
    expect(currentActor()).toEqual(SYSTEM_ACTOR);
    const seen = await runAsActor(deviceActor('d1'), async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentActor();
    });
    expect(seen).toEqual({ type: 'device', id: 'd1' });
    expect(currentActor()).toEqual(SYSTEM_ACTOR);
  });

  it('keeps concurrent contexts apart', async () => {
    const run = (id: string) =>
      runAsActor(deviceActor(id), async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return currentActor().id;
      });
    expect(await Promise.all([run('a'), run('b')])).toEqual(['a', 'b']);
  });
});

describe('EventLogService (R19, R20)', () => {
  it('records the type, the detail and the current actor', async () => {
    const repo = new InMemoryEventLogRepository();
    const service = new EventLogService(repo);
    await service.record('x.happened', { id: 1 });
    await runAsActor({ type: 'user', id: 'u1' }, () =>
      service.record('y.happened'),
    );
    expect(repo.entries).toEqual([
      { type: 'x.happened', actor: SYSTEM_ACTOR, detail: { id: 1 } },
      { type: 'y.happened', actor: { type: 'user', id: 'u1' }, detail: null },
    ]);
  });

  it('never keeps templates, keys or tokens in the detail', async () => {
    const repo = new InMemoryEventLogRepository();
    await new EventLogService(repo).record('z', {
      studentId: 's1',
      active: true,
      template: 'AAAA',
      iv: 'BBBB',
      token: 't',
      ENCRYPTION_KEY: 'k',
      apiKey: 'k',
    });
    expect(repo.entries[0]?.detail).toEqual({ studentId: 's1', active: true });
  });

  it('does not fail the operation when the write fails', async () => {
    const service = new EventLogService({
      append: () => Promise.reject(new Error('db down')),
    });
    await expect(service.record('x')).resolves.toBeUndefined();
  });

  it('never keeps passwords, hashes or cookies, but keeps session counters', async () => {
    const repo = new InMemoryEventLogRepository();
    await new EventLogService(repo).record('auth.test', {
      userId: 'u1',
      temporaryPassword: 'x',
      passwordHash: 'x',
      tokenHash: 'x',
      cookie: 'x',
      session: 'x',
      authorization: 'x',
      sessionsClosed: 3,
    });
    expect(repo.entries[0].detail).toEqual({ userId: 'u1', sessionsClosed: 3 });
  });
});
