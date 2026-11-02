import { describe, expect, it } from 'vitest';
import { fakeServer, invoke } from '../testing.js';

const ok = {
  status: 'ok',
  deviceId: 'esp32-sim-01',
  templates: 25,
  chunks: 3,
  scheduleId: 'sch1',
  omitted: 0,
  error: null,
};

describe('gym sync', () => {
  it('runs without an action, shows blocks and templates, and returns 0', async () => {
    const s = fakeServer(() => ({ body: ok }));
    const { code, out } = await invoke(['sync'], { fetch: s.fetch });
    expect(code).toBe(0);
    expect(s.calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/sync',
        apiKey: 'test-key',
      }),
    ]);
    expect(out).toContain('25 template(s) in 3 chunk(s)');
    expect(out).toContain('Schedule sch1 sent');
  });

  it('accepts global options right after sync and its own --help', async () => {
    const s = fakeServer(() => ({ body: ok }));
    expect(
      (await invoke(['sync', '--api-key', 'other-key'], { fetch: s.fetch }))
        .code,
    ).toBe(0);
    expect(s.calls[0]?.apiKey).toBe('other-key');
    const help = await invoke(['sync', '--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('Usage: gym sync');
  });

  it('warns about students left out', async () => {
    const s = fakeServer(() => ({
      body: { ...ok, scheduleId: null, omitted: 4 },
    }));
    const { out } = await invoke(['sync'], { fetch: s.fetch });
    expect(out).toContain('No schedule to send.');
    expect(out).toContain('4 student(s) left out');
  });

  it('exits 1 when the sync failed', async () => {
    const s = fakeServer(() => ({
      body: {
        ...ok,
        status: 'failed',
        chunks: 1,
        templates: 10,
        error: 'CHUNK_FAILED',
      },
    }));
    const { code, err } = await invoke(['sync'], { fetch: s.fetch });
    expect(code).toBe(1);
    expect(err).toContain('CHUNK_FAILED');
  });

  it('explains the 409 when no device is online', async () => {
    const s = fakeServer(() => ({
      status: 409,
      body: { message: 'No single device is online; connect one' },
    }));
    const { code, err } = await invoke(['sync'], { fetch: s.fetch });
    expect(code).toBe(1);
    expect(err).toContain('Nothing was synced');
    expect(err).toContain('No single device is online');
  });

  it('rejects stray arguments', async () => {
    const s = fakeServer(() => ({ body: ok }));
    expect((await invoke(['sync', 'now'], { fetch: s.fetch })).code).toBe(2);
  });
});
