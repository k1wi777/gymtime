import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MessageProcessor } from '../devices/message-processor.service.js';
import { OutboundSender } from '../devices/outbound-sender.service.js';
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
  ) {}

  onModuleInit(): void {
    this.processor.registerHandler(
      'fingerprint.scan',
      async (deviceId, message) => {
        if (message.type !== 'fingerprint.scan') return;
        const outcome = await this.attendance.recordScan(
          deviceId,
          message.payload.slot,
          message.ts,
        );
        this.send(
          deviceId,
          buildScanResult(outcome.decision, outcome.student, message.id, outcome.at),
        );
      },
    );

    this.processor.registerHandler(
      'fingerprint.unknown',
      (deviceId, message) => {
        if (message.type !== 'fingerprint.unknown') return;
        const at = this.attendance.recordUnknown(deviceId);
        this.send(deviceId, buildUnknownScanResult(message.id, at));
      },
    );

    this.processor.registerHandler('button.pressed', (deviceId, message) => {
      if (message.type !== 'button.pressed') return;
      this.attendance.recordButton(deviceId);
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
