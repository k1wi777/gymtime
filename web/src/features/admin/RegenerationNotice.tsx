import type { Regeneration } from '@/api/types';
import { Notice } from '@/ui/Notice';

/** What the server did with the occurrences after a change (R3, R4). */
export function RegenerationNotice({
  result,
  onDismiss,
}: {
  result: Regeneration;
  onDismiss?: () => void;
}) {
  return (
    <Notice
      kind="success"
      title="Ocurrencias actualizadas"
      {...(onDismiss ? { onDismiss } : {})}
    >
      <ul>
        <li>
          Creadas: <strong>{result.created}</strong>
        </li>
        <li>
          Borradas: <strong>{result.deleted}</strong>
        </li>
        <li>
          Ajustadas: <strong>{result.updated}</strong>
        </li>
        <li>
          Conservadas (con historial o ya iniciadas):{' '}
          <strong>{result.kept}</strong>
        </li>
      </ul>
    </Notice>
  );
}
