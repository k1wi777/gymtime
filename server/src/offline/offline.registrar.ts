import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { MessageProcessor } from '../devices/message-processor.service.js';
import { SyncService } from '../sync/sync.service.js';
import { OfflineEventsService } from './offline-events.service.js';
import { OfflineSnapshotService } from './offline-snapshot.service.js';

/**
 * Connects offline mode to the rest through their extension points: the
 * `offline.events` message handler and the end of every sync. Neither
 * `devices` nor `sync` know this module.
 */
@Injectable()
export class OfflineRegistrar implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfflineRegistrar.name);

  constructor(
    private readonly processor: MessageProcessor,
    private readonly sync: SyncService,
    private readonly events: OfflineEventsService,
    private readonly snapshots: OfflineSnapshotService,
  ) {}

  onModuleInit(): void {
    this.processor.registerHandler(
      'offline.events',
      async (deviceId, message) => {
        if (message.type !== 'offline.events') return;
        const { batch, last, events } = message.payload;
        await this.events.handleBatch(deviceId, {
          messageId: message.id,
          batch,
          last,
          events,
        });
        // After the batch is saved, so `open`/`exited` already include it.
        await this.snapshots
          .onBatchProcessed(deviceId, last)
          .catch((error: unknown) =>
            this.logger.error({
              event: 'offline_snapshot_release_failed',
              deviceId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      },
    );
    this.sync.onSynced((event) => this.snapshots.onSynced(event));
  }

  onModuleDestroy(): void {
    this.snapshots.stop();
  }
}
