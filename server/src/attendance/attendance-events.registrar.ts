import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DISPLAY_CONFIG,
  type DisplayConfig,
} from '../config/display.config.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { MessageProcessor } from '../devices/message-processor.service.js';
import { OutboundSender } from '../devices/outbound-sender.service.js';
import { InstancesService } from '../schedules/instances.service.js';
import { SyncService } from '../sync/sync.service.js';
import { AttendanceService } from './attendance.service.js';
import {
  buildScanResult,
  buildUnknownScanResult,
  type ScanResultMessage,
} from './domain/scan-result.js';

/**
 * Wires attendance to the device gateway through its extension points: the
 * message handlers and the sync's open-sessions provider. Neither `devices`
 * nor `sync` know this module.
 */
@Injectable()
export class AttendanceEventsRegistrar implements OnModuleInit {
  constructor(
    private readonly processor: MessageProcessor,
    private readonly sync: SyncService,
    private readonly attendance: AttendanceService,
    private readonly sender: OutboundSender,
    private readonly events: SystemEventsService,
    private readonly instances: InstancesService,
    @Inject(DISPLAY_CONFIG) private readonly display: DisplayConfig,
  ) {}

  onModuleInit(): void {
    // Occurrences with sessions are history: regenerating schedules keeps them.
    this.instances.addHistoryProbe((ids) =>
      this.attendance.instanceIdsWithSessions(ids),
    );
    this.processor.registerHandler(
      'fingerprint.scan',
      async (deviceId, message) => {
        if (message.type !== 'fingerprint.scan') return;
        const outcome = await this.attendance.recordScan(
          deviceId,
          message.payload.slot,
          message.ts,
        );
        this.events.emit(
          'scan',
          {
            deviceId,
            slot: message.payload.slot,
            result: outcome.decision.kind,
            studentId: outcome.student?.id ?? null,
            studentName: outcome.student?.name ?? null,
            reason:
              outcome.decision.kind === 'denied'
                ? outcome.decision.reason
                : null,
          },
          outcome.at,
        );
        this.send(
          deviceId,
          buildScanResult(
            outcome.decision,
            outcome.student,
            message.id,
            outcome.at,
            this.display,
          ),
        );
      },
    );

    this.processor.registerHandler(
      'fingerprint.unknown',
      (deviceId, message) => {
        if (message.type !== 'fingerprint.unknown') return;
        const at = this.attendance.recordUnknown(deviceId);
        this.events.emit(
          'scan',
          {
            deviceId,
            slot: null,
            result: 'unknown',
            studentId: null,
            studentName: null,
            reason: null,
          },
          at,
        );
        this.send(
          deviceId,
          buildUnknownScanResult(message.id, at, this.display),
        );
      },
    );

    this.processor.registerHandler('button.pressed', (deviceId, message) => {
      if (message.type !== 'button.pressed') return;
      return this.attendance.recordButton(deviceId);
    });

    this.sync.setOpenSessionsProvider({
      listStudentIds: () => this.attendance.listOpenStudentIds(),
    });
  }

  /**
   * `scan.result` is sent without awaiting its ack: the scan's own ack must
   * leave in under 5 s (protocol), and the sender retries on its own.
   */
  private send(deviceId: string, message: ScanResultMessage): void {
    void this.sender.send(deviceId, message);
  }
}
