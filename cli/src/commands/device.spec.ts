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
