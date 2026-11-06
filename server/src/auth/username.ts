export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,49}$/;

/** Usernames are compared case-insensitively and without surrounding spaces. */
export const normalizeUsername = (raw: string): string =>
  raw.trim().toLowerCase();
