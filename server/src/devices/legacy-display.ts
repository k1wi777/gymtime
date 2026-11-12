import { buildDisplayPayload } from '@gymtime/shared';

/**
 * Orders persisted before `title/subtitle/tone` only carry `line1/line2`
 * (and `durationSec`); they are completed on read when they are resent. Newer
 * payloads are returned untouched. No data migration needed.
 */
export function completeLegacyDisplay(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return payload;
  const old = payload as Record<string, unknown>;
  if ('title' in old || typeof old.line1 !== 'string') return payload;
  return {
    ...buildDisplayPayload({
      title: old.line1,
      subtitle: typeof old.line2 === 'string' ? old.line2 : '',
      tone: 'info',
    }),
    durationSec: old.durationSec,
  };
}
