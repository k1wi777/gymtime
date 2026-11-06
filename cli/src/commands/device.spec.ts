import { describe, expect, it } from 'vitest';
import { fakeServer, invoke } from '../testing.js';

const device = (over: Record<string, unknown> = {}) => ({
  deviceId: 'd1',
  online: true,
  lastConnectedAt: '2026-11-02T16:00:00.000Z',
  firmwareVersion: '1.2.3',
  pendingCommands: 2,
  ...over,
});

describe('gym device status', () => {
  it('shows online, last connection in Bogota, firmware and pending orders', async () => {
    const server = fakeServer(() => ({ body: [device()] }));
    const { code, out } = await invoke(['device', 'status'], {
      fetch: server.fetch,
    });

    expect(code).toBe(0);
    expect(server.calls[0]).toMatchObject({
      method: 'GET',
      path: '/devices/status',
    });
    expect(out).toContain('device');
    expect(out).toContain('d1');
    expect(out).toContain('yes');
    expect(out).toContain('2026-11-02 11:00');
    expect(out).toContain('1.2.3');
    expect(out).toContain('2');
  });

  it('tolerates missing fields and an older server without pendingCommands', async () => {
    const server = fakeServer(() => ({
      body: [
        device({
          online: false,
          lastConnectedAt: null,
          firmwareVersion: null,
          pendingCommands: undefined,
        }),
      ],
    }));
    const { code, out } = await invoke(['device', 'status'], {
      fetch: server.fetch,
    });

    expect(code).toBe(0);
    expect(out).toContain('no');
    expect(out).toContain('never');
    expect(out).toContain('-');
    expect(out.trim().split('\n').at(-1)).toMatch(/ 0$/);
  });

  it('reports an empty list without treating it as an error', async () => {
    const server = fakeServer(() => ({ body: [] }));
    const { code, out } = await invoke(['device', 'status'], {
      fetch: server.fetch,
    });

    expect(code).toBe(0);
    expect(out).toBe('No devices registered yet.');
  });
});

describe('gym device message', () => {
  const ok = (status: string) => ({
    body: { commandId: 'c1', deviceId: 'd1', status },
  });

  it('normalizes the text and posts both lines with the options', async () => {
    const server = fakeServer(() => ok('acked'));
    const { code, out } = await invoke(
      [
        'device',
        'message',
        'Atención',
        'mañana',
        '--seconds',
        '5',
        '--device',
        'd1',
      ],
      { fetch: server.fetch },
    );
    expect(code).toBe(0);
    expect(server.calls[0]).toMatchObject({
      method: 'POST',
      path: '/devices/messages',
      body: {
        deviceId: 'd1',
        line1: 'Atencion',
        line2: 'manana',
        durationSec: 5,
      },
    });
    expect(out).toContain('Message shown on d1');
  });

  it('accepts a single line and says when the order was queued', async () => {
    const server = fakeServer(() => ok('queued'));
    const { code, out } = await invoke(['device', 'message', 'Hola'], {
      fetch: server.fetch,
    });
    expect(code).toBe(0);
    expect(server.calls[0]?.body).toEqual({ line1: 'Hola' });
    expect(out).toContain('queued');
  });

  it('exits with an error when the device did not confirm', async () => {
    const server = fakeServer(() => ok('failed'));
    const { code, err } = await invoke(['device', 'message', 'Hola'], {
      fetch: server.fetch,
    });
    expect(code).toBe(1);
    expect(err).toContain('did not confirm');
  });

  it('rejects long lines and extra lines without calling the server', async () => {
    const server = fakeServer(() => ok('acked'));
    const long = await invoke(['device', 'message', 'x'.repeat(17)], {
      fetch: server.fetch,
    });
    expect(long.code).toBe(1);
    expect(long.err).toContain('la línea 1 tiene 17 caracteres; máximo 16');
    const three = await invoke(['device', 'message', 'a', 'b', 'c'], {
      fetch: server.fetch,
    });
    expect(three.code).toBe(1);
    expect(three.err).toContain('máximo 2');
    const emoji = await invoke(['device', 'message', 'hola 😀'], {
      fetch: server.fetch,
    });
    expect(emoji.code).toBe(1);
    expect(server.calls).toHaveLength(0);
  });

  it('validates usage: text and seconds', async () => {
    expect((await invoke(['device', 'message'])).code).toBe(2);
    for (const seconds of ['0', '61', 'abc', '1.5']) {
      expect(
        (await invoke(['device', 'message', 'Hola', '--seconds', seconds]))
          .code,
      ).toBe(2);
    }
  });

  it('shows the server rejection', async () => {
    const server = fakeServer(() => ({
      status: 404,
      body: { message: 'No device known' },
    }));
    const { code, err } = await invoke(['device', 'message', 'Hola'], {
      fetch: server.fetch,
    });
    expect(code).toBe(1);
    expect(err).toContain('No device known');
  });
});
