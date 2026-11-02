/** Invalid or missing configuration; messages never contain secret values. */
export class ConfigError extends Error {}

/** Usage mistake: the message is shown together with the matching usage. */
export class UsageError extends Error {}

/** Operational failure (server error, unreachable server, business rule). */
export class CliError extends Error {}
