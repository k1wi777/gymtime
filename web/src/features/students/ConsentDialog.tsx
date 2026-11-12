'use client';

import { useEffect, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { ConsentText, Student } from '@/api/types';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Notice } from '@/ui/Notice';
import styles from './ConsentDialog.module.css';

interface Props {
  /** The student whose consent is recorded; `null` keeps the dialog closed. */
  student: Student | null;
  onClose: () => void;
  /** The server stored the consent. */
  onRecorded: (student: Student) => void;
}

/**
 * Shows the consent text the server holds (never a copy of it) and records
 * that exact version once the person reading it accepts (Ley 1581, E25).
 */
export function ConsentDialog(props: Props) {
  // A new student starts with a clean dialog (text, checkbox and errors).
  return <ConsentDialogBody key={props.student?.id ?? 'closed'} {...props} />;
}

function ConsentDialogBody({ student, onClose, onRecorded }: Props) {
  const [text, setText] = useState<ConsentText | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!student) return;
    const controller = new AbortController();
    call(
      getApi().client.GET('/students/consent', { signal: controller.signal }),
    )
      .then(setText)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(describeError(error));
      });
    return () => controller.abort();
  }, [student]);

  const record = async (): Promise<void> => {
    if (!student || !text) return;
    setBusy(true);
    setFailure(null);
    try {
      const updated = await call(
        getApi().client.POST('/students/{id}/consent', {
          params: { path: { id: student.id } },
          body: { version: text.version },
        }),
      );
      onRecorded(updated);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={student !== null}
      title="Registrar consentimiento"
      confirmLabel="Registrar consentimiento"
      confirmDisabled={!accepted || !text}
      busy={busy}
      onConfirm={() => void record()}
      onCancel={onClose}
    >
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      {text && (
        <>
          <p className={styles.text}>{text.text}</p>
          <label className={styles.accept}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              {student?.name} leyó este texto y lo acepta de forma libre y
              expresa.
            </span>
          </label>
        </>
      )}
    </ConfirmDialog>
  );
}
