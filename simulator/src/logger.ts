export interface Logger {
  /** A frame sent to (`out`) or received from (`in`) the server. */
  frame(direction: 'in' | 'out', raw: string, note?: string): void;
  /** A state transition or lifecycle event. */
  state(text: string): void;
  warn(text: string): void;
}

const MASK = '***';

/** Re-serialises a frame hiding the hello token; other frames pass untouched. */
export function redact(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.payload && typeof parsed.payload.token === 'string') {
      parsed.payload.token = MASK;
      return JSON.stringify(parsed);
    }
  } catch {
    // Not JSON: nothing to mask.
  }
  return raw;
}

function frameType(raw: string): string {
  try {
    const type = JSON.parse(raw)?.type;
    return typeof type === 'string' ? type : '?';
  } catch {
    return '?';
  }
}

export function createConsoleLogger(
  write: (line: string) => void = (line) => console.log(line),
  now: () => Date = () => new Date(),
): Logger {
  const stamp = () => now().toISOString().slice(11, 23);
  return {
    frame(direction, raw, note) {
      const arrow = direction === 'out' ? '-->' : '<--';
      const suffix = note ? ` (${note})` : '';
      write(
        `${stamp()} ${arrow} ${frameType(raw).padEnd(16)} ${redact(raw)}${suffix}`,
      );
    },
    state(text) {
      write(`${stamp()} ::: ${text}`);
    },
    warn(text) {
      write(`${stamp()} !!! ${text}`);
    },
  };
}
