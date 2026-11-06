import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: the password is read from a screen and typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const LENGTH = 16;

/** Server-generated one-time password (about 93 bits of entropy). */
export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < LENGTH; i += 1) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}
