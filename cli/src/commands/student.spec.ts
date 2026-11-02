import { describe, expect, it } from 'vitest';
import { fakeServer, invoke } from '../testing.js';

const ana = {
  id: 'id-1',
  document: '123',
  name: 'Ana',
  program: 'Cross',
  active: true,
  consented: true,
};
const luis = {
  ...ana,
  id: 'id-2',
  document: '456',
  name: 'Luis',
  program: null,
  active: false,
  consented: false,
};

describe('student add', () => {
  it('creates the student and prints its data', async () => {
    const server = fakeServer(() => ({ status: 201, body: ana }));
    const { code, out } = await invoke(
      [
        'student',
        'add',
        '--document',
        '123',
        '--name',
        'Ana',
        '--program',
        'Cross',
        '--consented',
      ],
      { fetch: server.fetch },
    );
    expect(code).toBe(0);
    expect(server.calls[0]).toMatchObject({
      method: 'POST',
      path: '/students',
      body: { document: '123', name: 'Ana', program: 'Cross', consented: true },
    });
    expect(out).toContain('id-1');
    expect(out).toContain('Ana');
  });

  it('defaults program to null and consent to false', async () => {
    const server = fakeServer(() => ({ status: 201, body: ana }));
    await invoke(['student', 'add', '--document', '1', '--name', 'A'], {
      fetch: server.fetch,
    });
    expect(server.calls[0]?.body).toEqual({
      document: '1',
      name: 'A',
      program: null,
      consented: false,
    });
  });

  it('informs the conflict of a duplicate document', async () => {
    const server = fakeServer(() => ({
      status: 409,
      body: { message: 'dup' },
    }));
    const { code, err } = await invoke(
      ['student', 'add', '--document', '123', '--name', 'Ana'],
      { fetch: server.fetch },
    );
    expect(code).toBe(1);
    expect(err).toContain('document 123 already exists');
  });

  it('requires document and name', async () => {
    expect((await invoke(['student', 'add', '--document', '1'])).code).toBe(2);
    expect((await invoke(['student', 'add', '--name', 'A'])).code).toBe(2);
  });
});

describe('student list', () => {
  it('prints a table', async () => {
    const server = fakeServer(() => ({ body: [ana, luis] }));
    const { code, out } = await invoke(['student', 'list'], {
      fetch: server.fetch,
    });
    expect(code).toBe(0);
    expect(server.calls[0]?.path).toBe('/students');
    const [header, row1, row2] = out.split('\n');
    expect(header).toMatch(/^DOCUMENT\s+NAME\s+PROGRAM\s+ACTIVE\s+CONSENT$/);
    expect(row1).toMatch(/^123\s+Ana\s+Cross\s+yes\s+yes$/);
    expect(row2).toMatch(/^456\s+Luis\s+-\s+no\s+no$/);
  });

  it('filters by active and validates the value', async () => {
    const server = fakeServer(() => ({ body: [] }));
    const result = await invoke(['student', 'list', '--active', 'true'], {
      fetch: server.fetch,
    });
    expect(server.calls[0]?.path).toBe('/students?active=true');
    expect(result.out).toBe('No students found.');
    expect((await invoke(['student', 'list', '--active', 'maybe'])).code).toBe(
      2,
    );
  });
});

describe('student remove', () => {
  it('resolves the document and deactivates by id', async () => {
    const server = fakeServer((call) =>
      call.method === 'GET'
        ? { body: [ana, luis] }
        : { body: { ...ana, active: false } },
    );
    const { code, out } = await invoke(['student', 'remove', '123'], {
      fetch: server.fetch,
    });
    expect(code).toBe(0);
    expect(server.calls[1]).toMatchObject({
      method: 'DELETE',
      path: '/students/id-1',
    });
    expect(out).toContain('deactivated');
  });

  it('fails when the document does not exist', async () => {
    const server = fakeServer(() => ({ body: [ana] }));
    const { code, err } = await invoke(['student', 'remove', '999'], {
      fetch: server.fetch,
    });
    expect(code).toBe(1);
    expect(err).toContain('No student with document 999');
    expect(server.calls).toHaveLength(1);
  });

  it('requires exactly one document', async () => {
    expect((await invoke(['student', 'remove'])).code).toBe(2);
    expect((await invoke(['student', 'remove', 'a', 'b'])).code).toBe(2);
  });
});
