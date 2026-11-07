import { randomUUID } from 'node:crypto';
import { OfflineQueue } from './offline-queue.js';
import { OfflineSync } from './offline-sync.js';

function setup(count: number, batchMax = 3) {
  const queue = new OfflineQueue(null);
  for (let i = 0; i < count; i++) {
    queue.push({ type: 'unknown' }, 1_760_000_000 + i, randomUUID());
  }
  const sent: {
    frameId: string;
    batch: number;
    last: boolean;
    ids: string[];
  }[] = [];
  const warns: string[] = [];
  const sync = new OfflineSync(
    queue,
    {
      sendBatch: (p) => {
        const frameId = randomUUID();
        sent.push({
          frameId,
          batch: p.batch,
          last: p.last,
          ids: p.events.map((e) => e.id),
        });
        return frameId;
      },
      log: () => {},
      warn: (t) => warns.push(t),
    },
    batchMax,
  );
  return { queue, sync, sent, warns };
}

describe('OfflineSync', () => {
  it('does nothing with an empty queue', () => {
    const { sync, sent } = setup(0);
    sync.start();
    expect(sent).toHaveLength(0);
  });

  it('sends batches one at a time and removes each only on an ok ack', () => {
    const { queue, sync, sent } = setup(7);
    sync.start();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ batch: 1, last: false });
    expect(queue.size).toBe(7);
    sync.onAck(sent[0]!.frameId, true);
    expect(queue.size).toBe(4);
    sync.onAck(sent[1]!.frameId, true);
    expect(sent[2]).toMatchObject({ batch: 3, last: true });
    sync.onAck(sent[2]!.frameId, true);
    expect(queue.size).toBe(0);
  });

  it('keeps the events when the ack is an error and resends the same ids later', () => {
    const { queue, sync, sent, warns } = setup(2);
    sync.start();
    const firstIds = sent[0]!.ids;
    expect(sync.onAck(sent[0]!.frameId, false)).toBe(true);
    expect(queue.size).toBe(2);
    expect(warns).toHaveLength(1);
    sync.reset();
    sync.start();
    expect(sent[1]!.ids).toEqual(firstIds);
  });

  it('ignores acks that are not for the batch in flight', () => {
    const { sync, sent } = setup(1);
    sync.start();
    expect(sync.onAck(randomUUID(), true)).toBe(false);
    expect(sync.busy).toBe(true);
    sync.onAck(sent[0]!.frameId, true);
    expect(sync.busy).toBe(false);
  });
});
