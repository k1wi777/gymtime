'use client';

import { call, getApi } from '@/api/client';
import type { PanelPerson } from '@/api/types';
import { SOURCE_LABELS } from '@/lib/labels';
import { formatTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { Avatar } from '@/ui/Avatar';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/icons';
import { Modal } from '@/ui/Modal';
import styles from './PersonSheet.module.css';

interface Props {
  person: PanelPerson | null;
  onClose: () => void;
  /** Goes to «Enrolar huella» with this student already chosen. */
  onAssign: (studentId: string) => void;
}

/**
 * Right-hand sheet with the student's card. The snapshot of «Ahora» does not
 * carry the program, so it is read from the students list (best effort: the
 * sheet works without it).
 */
export function PersonSheet({ person, onClose, onAssign }: Props) {
  return (
    <Modal
      open={person !== null}
      title="Ficha del estudiante"
      ariaLabel={person ? `Ficha de ${person.name}` : 'Ficha del estudiante'}
      placement="side"
      onClose={onClose}
    >
      {person && <SheetBody person={person} onAssign={onAssign} />}
    </Modal>
  );
}

function SheetBody({
  person,
  onAssign,
}: {
  person: PanelPerson;
  onAssign: (studentId: string) => void;
}) {
  const students = useResource(
    (signal) =>
      call(
        getApi().client.GET('/students', {
          params: { query: { active: 'true' } },
          signal,
        }),
      ),
    [],
  );
  const program = students.data?.find(
    (s) => s.id === person.studentId,
  )?.program;
  const inside = person.sessionStatus === 'abierta' && person.enteredAt;
  const state = inside
    ? `Dentro desde ${formatTime(person.enteredAt as string)}`
    : person.sessionStatus === 'cerrada' ||
        person.sessionStatus === 'no_registrada'
      ? 'Ya salió'
      : 'Aún no llega';
  const has = person.hasFingerprint;

  return (
    <>
      <div className={styles.identity}>
        <Avatar
          name={person.name}
          id={person.studentId}
          size={84}
          fontSize={28}
        />
        <h3 className={styles.name}>{person.name}</h3>
        {program && <div className={styles.program}>{program}</div>}
        <div className={styles.doc}>Documento {person.document}</div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Estado ahora</dt>
          <dd>
            <strong>{state}</strong>
            {inside && person.source && (
              <Badge tone="info" size="sm">
                {SOURCE_LABELS[person.source]}
              </Badge>
            )}
          </dd>
        </div>
        <div>
          <dt>Huella</dt>
          <dd>
            <span className={`${styles.chip} ${has ? styles.ok : styles.none}`}>
              {has ? 'Registrada' : 'Sin huella'}
            </span>
          </dd>
        </div>
      </dl>
      <div className={styles.actions}>
        {!has && (
          <div className={styles.warn}>
            Sin huella no puede marcar entrada ni salida. Regístrela ahora para
            que el lector lo reconozca.
          </div>
        )}
        <button
          type="button"
          className={`${styles.assign} ${has ? styles.secondary : styles.primary}`}
          onClick={() => onAssign(person.studentId)}
        >
          <Icon name="huella" size={20} />
          {has ? 'Volver a registrar huella' : 'Asignar huella'}
        </button>
        <div className={styles.note}>
          Se abre «Enrolar huella» con {person.name} ya elegido.
        </div>
      </div>
    </>
  );
}
