import { describe, expect, it } from 'vitest';
import { COMMAND_HELP, MAX_SLOT, parseCommand } from './commands.js';

describe('parseCommand', () => {
  it('parses scan with a valid slot', () => {
    expect(parseCommand('scan 1')).toEqual({ kind: 'scan', slot: 1 });
    expect(parseCommand('  SCAN 162 ')).toEqual({ kind: 'scan', slot: 162 });
  });

  it('rejects out-of-range, non-numeric and malformed scans', () => {
    for (const input of ['scan', 'scan 0', 'scan 163', 'scan abc', 'scan 2 3']) {
      expect(parseCommand(input).kind).toBe('invalid');
    }
    expect(MAX_SLOT).toBe(162);
  });

  it('parses the side-effect free commands', () => {
    expect(parseCommand('button')).toEqual({ kind: 'button' });
    expect(parseCommand('disconnect')).toEqual({ kind: 'disconnect' });
    expect(parseCommand('reconnect')).toEqual({ kind: 'reconnect' });
    expect(parseCommand('help')).toEqual({ kind: 'help' });
  });

  it('reports empty input, unknown commands and extra arguments', () => {
    expect(parseCommand('   ')).toEqual({ kind: 'empty' });
    expect(parseCommand('reboot')).toMatchObject({
      kind: 'invalid',
      reason: 'unknown command "reboot"',
    });
    expect(parseCommand('button now').kind).toBe('invalid');
  });

  it('documents every command in the help text', () => {
    for (const word of ['scan', 'button', 'disconnect', 'reconnect', 'help']) {
      expect(COMMAND_HELP).toContain(word);
    }
  });
});
