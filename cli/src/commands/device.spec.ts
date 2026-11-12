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
    expect(out.trim().split('\n').at(-1)).toMatch(/ 0 +legacy$/);
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

  it('normalizes the text and posts title, subtitle and tone with the options', async () => {
    const server = fakeServer(() => ok('acked'));
    const { code, out } = await invoke(
      [
        'device',
        'message',
        ' Atención ',
        'mañana',
        '--tone',
        'warning',
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
        title: 'Atención',
        subtitle: 'mañana',
        tone: 'warning',
        durationSec: 5,
      },
    });
    expect(out).toContain('Message shown on d1');
  });

  it('accepts only a title, defaults the tone and says when the order was queued', async () => {
    const server = fakeServer(() => ok('queued'));
    const { code, out } = await invoke(['device', 'message', 'Hola'], {
      fetch: server.fetch,
    });
    expect(code).toBe(0);
    expect(server.calls[0]?.body).toEqual({ title: 'Hola', tone: 'info' });
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

  it('turns a literal \\n of the subtitle into a line break', async () => {
    const server = fakeServer(() => ok('acked'));
    await invoke(['device', 'message', 'Hola', 'uno\\ndos'], {
      fetch: server.fetch,
    });
    expect(server.calls[0]?.body).toMatchObject({ subtitle: 'uno\ndos' });
  });

  it('rejects texts that do not fit without calling the server', async () => {
    const server = fakeServer(() => ok('acked'));
    const long = await invoke(['device', 'message', 'x'.repeat(33)], {
      fetch: server.fetch,
    });
    expect(long.code).toBe(1);
    expect(long.err).toContain('el título tiene 33 caracteres; máximo 32');
    const subtitle = await invoke(['device', 'message', 'a', 'x'.repeat(81)], {
      fetch: server.fetch,
    });
    expect(subtitle.code).toBe(1);
    expect(subtitle.err).toContain('máximo 80');
    const lines = await invoke(['device', 'message', 'a', 'b\\nc\\nd'], {
      fetch: server.fetch,
    });
    expect(lines.code).toBe(1);
    expect(lines.err).toContain('máximo 2');
    expect(server.calls).toHaveLength(0);
  });

  it('rejects an invalid tone and a third text argument as usage errors', async () => {
    const server = fakeServer(() => ok('acked'));
    expect(
      (
        await invoke(['device', 'message', 'Hola', '--tone', 'purple'], {
          fetch: server.fetch,
        })
      ).code,
    ).toBe(2);
    expect(
      (
        await invoke(['device', 'message', 'a', 'b', 'c'], {
          fetch: server.fetch,
        })
      ).code,
    ).toBe(2);
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

describe('gym device register | rotate | revoke (H11)', () => {
  it('status shows the token state, legacy for older servers', async () => {
    const server = fakeServer(() => ({
      body: [device({ tokenStatus: 'own' }), device({ deviceId: 'd2' })],
    }));
    const { out } = await invoke(['device', 'status'], { fetch: server.fetch });
    expect(out).toMatch(/token/);
    expect(out).toMatch(/d1.* own$/m);
    expect(out).toMatch(/d2.* legacy$/m);
  });

  it('register prints the token once and sends only the id', async () => {
    const server = fakeServer(() => ({
      status: 201,
      body: { deviceId: 'esp32-01', token: 'gt_dev_secret' },
    }));
    const { code, out } = await invoke(['device', 'register', 'esp32-01'], {
      fetch: server.fetch,
    });
    expect(code).toBe(0);
    expect(server.calls[0]).toMatchObject({
      method: 'POST',
      path: '/devices',
      body: { deviceId: 'esp32-01' },
    });
    expect(out).toContain('gt_dev_secret');
    expect(out).toContain('ONCE');
  });

  it('rotate calls the rotate endpoint and prints the new token', async () => {
    const server = fakeServer(() => ({
      body: { deviceId: 'd1', token: 'gt_dev_new' },
    }));
    const { code, out } = await invoke(['device', 'rotate', 'd1'], {
      fetch: server.fetch,
    });
    expect(code).toBe(0);
    expect(server.calls[0]?.path).toBe('/devices/d1/token/rotate');
    expect(out).toContain('gt_dev_new');
  });

  it('revoke needs --yes and never prints a token', async () => {
    const server = fakeServer(() => ({
      body: { deviceId: 'd1', tokenStatus: 'revoked' },
    }));
    const refused = await invoke(['device', 'revoke', 'd1'], {
      fetch: server.fetch,
    });
    expect(refused.code).not.toBe(0);
    expect(server.calls).toHaveLength(0);
    const done = await invoke(['device', 'revoke', 'd1', '--yes'], {
      fetch: server.fetch,
    });
    expect(done.code).toBe(0);
    expect(server.calls[0]?.path).toBe('/devices/d1/token/revoke');
    expect(done.out).toContain('revoked');
  });

  it('asks for the device id', async () => {
    const server = fakeServer(() => ({}));
    const { code, err } = await invoke(['device', 'rotate'], {
      fetch: server.fetch,
    });
    expect(code).not.toBe(0);
    expect(err).toContain('device id');
  });
});
