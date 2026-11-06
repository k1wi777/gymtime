import { currentActor } from '../common/audit/actor.js';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { ConnectionRegistry } from './connection-registry.js';
import { defaultDevicesConfig } from './devices.config.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';
import { InMemoryProcessedMessagesRepository } from './infrastructure/in-memory-processed-messages.repository.js';
import {
  MessageProcessor,
  type Action,
  type Session,
} from './message-processor.service.js';
import { OutboundSender } from './outbound-sender.service.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { frame, helloFrame, statusFrame } from './testing/frames.js';

const TOKEN = 'device-token-123456';

function sent(actions: Action[]) {
  return actions.flatMap((a) => (a.kind === 'send' ? [a.message] : []));
}

describe('MessageProcessor', () => {
  let processor: MessageProcessor;
  let devices: DevicesService;
  let sender: OutboundSender;
  let processed: InMemoryProcessedMessagesRepository;
  let session: Session;

  beforeEach(() => {
    devices = new DevicesService(
      new InMemoryDevicesRepository(),
      new InMemoryDeviceCommandsRepository(),
    );
    sender = new OutboundSender(
      new ConnectionRegistry(),
      devices,
      defaultDevicesConfig,
      new InMemoryDeviceCommandsRepository(),
      new SystemEventsService(),
    );
    processed = new InMemoryProcessedMessagesRepository();
    const config = {
      get: () => TOKEN,
    } as unknown as ConfigService<Env, true>;
    processor = new MessageProcessor(
      devices,
      sender,
      config,
      defaultDevicesConfig,
      processed,
    );
    session = { deviceId: null };
  });

  async function authenticate() {
    const actions = await processor.process(session, helloFrame(TOKEN));
    session.deviceId = 'esp32-1';
    return actions;
  }

  describe('hello', () => {
    it('answers hello.ok and authenticates with a valid token', async () => {
      const raw = helloFrame(TOKEN);
      const id = JSON.parse(raw).id;
      const actions = await processor.process(session, raw);
      expect(actions[0]).toEqual({
        kind: 'authenticated',
        deviceId: 'esp32-1',
        firmwareVersion: '1.0.0',
      });
      expect(sent(actions)[0]).toMatchObject({
        type: 'hello.ok',
        ref: id,
        payload: { heartbeatSec: 30 },
      });
      expect(await devices.listStatus()).toMatchObject([
        { deviceId: 'esp32-1', online: true, firmwareVersion: '1.0.0' },
      ]);
    });

    it('rejects a wrong token with UNAUTHORIZED and closes', async () => {
      const actions = await processor.process(session, helloFrame('wrong'));
      expect(sent(actions)[0]).toMatchObject({
        type: 'ack',
        payload: { ok: false, error: 'UNAUTHORIZED' },
      });
      expect(actions.some((a) => a.kind === 'close')).toBe(true);
      expect(await devices.listStatus()).toEqual([]);
    });

    it('answers a repeated hello again without new authentication', async () => {
      await authenticate();
      const actions = await processor.process(session, helloFrame(TOKEN));
      expect(actions.map((a) => a.kind)).toEqual(['send']);
      expect(sent(actions)[0]).toMatchObject({ type: 'hello.ok' });
    });
  });

  describe('authentication and validation', () => {
    it('answers NOT_AUTHENTICATED without recording the message', async () => {
      const id = randomUUID();
      const actions = await processor.process(session, statusFrame(id));
      expect(sent(actions)[0]).toMatchObject({
        ref: id,
        payload: { ok: false, error: 'NOT_AUTHENTICATED' },
      });
      expect(await processed.findAck('esp32-1', id)).toBeNull();
    });

    it('answers an invalid message with the parser code when the id is recoverable', async () => {
      await authenticate();
      const id = randomUUID();
      const bad = frame('status', { uptime: 'x' }, { id });
      const actions = await processor.process(session, bad);
      expect(sent(actions)[0]).toMatchObject({
        ref: id,
        payload: { ok: false, error: 'INVALID_MESSAGE' },
      });
      expect(await processed.findAck('esp32-1', id)).toBeNull();
    });

    it('maps unknown type and unsupported version', async () => {
      await authenticate();
      const unknown = await processor.process(session, frame('nope', {}));
      const version = await processor.process(
        session,
        frame('status', {}, { v: 9 }),
      );
      expect(sent(unknown)[0]).toMatchObject({
        payload: { error: 'UNKNOWN_TYPE' },
      });
      expect(sent(version)[0]).toMatchObject({
        payload: { error: 'UNSUPPORTED_VERSION' },
      });
    });

    it('only ignores a message whose id cannot be recovered', async () => {
      await authenticate();
      expect(await processor.process(session, 'not json')).toEqual([]);
      expect(
        await processor.process(session, frame('status', {}, { id: 'x' })),
      ).toEqual([]);
    });
  });

  describe('ack and idempotency', () => {
    it('acks a valid message and records it', async () => {
      await authenticate();
      const id = randomUUID();
      const actions = await processor.process(session, statusFrame(id));
      expect(sent(actions)[0]).toMatchObject({
        type: 'ack',
        ref: id,
        payload: { ok: true },
      });
      expect(await processed.findAck('esp32-1', id)).not.toBeNull();
    });

    it('does not ack an incoming ack, it confirms the outbound message', async () => {
      await authenticate();
      const handleAck = vi.spyOn(sender, 'handleAck');
      const ref = randomUUID();
      const actions = await processor.process(
        session,
        frame('ack', { ok: true }, { ref }),
      );
      expect(actions).toEqual([]);
      expect(handleAck).toHaveBeenCalledWith('esp32-1', ref);
    });

    it('runs the handler on behalf of the device for the audit trail (R19)', async () => {
      await authenticate();
      let actor: unknown;
      processor.registerHandler('status', () => {
        actor = currentActor();
      });
      await processor.process(session, statusFrame());
      expect(actor).toEqual({ type: 'device', id: 'esp32-1' });
      expect(currentActor()).toEqual({ type: 'system', id: null });
    });

    it('does not reprocess a duplicate and resends the original ack', async () => {
      await authenticate();
      const handler = vi.fn();
      processor.registerHandler('status', handler);
      const raw = statusFrame();
      const first = sent(await processor.process(session, raw))[0];
      const second = sent(await processor.process(session, raw))[0];
      expect(handler).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('answers INTERNAL_ERROR and lets a retry run again when the handler fails', async () => {
      await authenticate();
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);
      processor.registerHandler('status', handler);
      const raw = statusFrame();
      const failed = sent(await processor.process(session, raw))[0];
      expect(failed).toMatchObject({
        payload: { ok: false, error: 'INTERNAL_ERROR' },
      });
      const retried = sent(await processor.process(session, raw))[0];
      expect(retried).toMatchObject({ payload: { ok: true } });
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
