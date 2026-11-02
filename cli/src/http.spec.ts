import { describe, expect, it } from 'vitest';
import { CliError } from './errors.js';
import { createHttpClient, type FetchLike } from './http.js';

function reply(status: number, body: unknown, statusText = ''): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

const client = (fetch: FetchLike) =>
  createHttpClient({ url: 'http://srv', apiKey: 'secret-key', fetch });

describe('http client', () => {
  it('sends x-api-key and a JSON body, and parses the answer', async () => {
    const calls: Parameters<FetchLike>[] = [];
    const result = await client(async (...args) => {
      calls.push(args);
      return reply(201, { id: '1' })(...args);
    }).request('POST', '/students', { name: 'a' });
    expect(result).toEqual({ id: '1' });
    const [url, init] = calls[0]!;
    expect(url).toBe('http://srv/students');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('secret-key');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.body).toBe('{"name":"a"}');
  });

  it('sends no content-type without a body', async () => {
    let headers: Record<string, string> = {};
    await client(async (...args) => {
      headers = args[1].headers;
      return reply(200, [])(...args);
    }).request('GET', '/students');
    expect(headers['content-type']).toBeUndefined();
  });

  it('shows the NestJS message of an HTTP error', async () => {
    await expect(
      client(
        reply(409, { message: 'Document already exists' }, 'Conflict'),
      ).request('POST', '/students', {}),
    ).rejects.toThrow('Server responded 409 Conflict: Document already exists');
    await expect(
      client(reply(400, { message: ['a', 'b'] })).request('GET', '/x'),
    ).rejects.toThrow('400: a; b');
  });

  it('explains a rejected key without echoing it', async () => {
    const error = await client(reply(401, { message: 'Unauthorized' }))
      .request('GET', '/x')
      .catch((e: Error) => e);
    expect((error as Error).message).toMatch(/API key was rejected/);
    expect((error as Error).message).not.toMatch(/secret-key/);
  });

  it('tolerates non-JSON error bodies', async () => {
    await expect(
      client(reply(502, '<html>bad gateway</html>')).request('GET', '/x'),
    ).rejects.toThrow(/^Server responded 502$/);
  });

  it('reports an unreachable server without stack or cause', async () => {
    const error = await client(async () => {
      throw new TypeError('fetch failed');
    })
      .request('GET', '/x')
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as Error).message).toBe('Could not connect to http://srv');
  });

  it('rejects an invalid success body', async () => {
    await expect(
      client(reply(200, 'not json')).request('GET', '/x'),
    ).rejects.toThrow(/Invalid response/);
  });
});
