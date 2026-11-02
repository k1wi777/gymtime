import { UsageError } from '../errors.js';

export function noPositionals(positionals: string[]): void {
  if (positionals.length > 0) {
    throw new UsageError(`unexpected argument "${positionals[0]}"`);
  }
}

export function required(value: unknown, flag: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UsageError(`${flag} is required`);
  }
  return value;
}
