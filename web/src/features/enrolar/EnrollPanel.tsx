'use client';

import { useCallback, useState } from 'react';
import { ApiError, call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { Enrollment, Student } from '@/api/types';
import { useLiveEvents, useResync } from '@/live/live-provider';
import {
  ENROLL_STEPS,
  ENROLL_STATUS_LABELS,
  enrollStepLabel,
  failureLabel,
} from '@/lib/labels';
import { ConsentDialog } from '@/features/students/ConsentDialog';
import { Badge } from '@/ui/Badge';
import { Notice } from '@/ui/Notice';
import styles from './Enrolar.module.css';

export const FINAL_STATUSES = [
  'done',
  'failed',
  'expired',
  'cancelled',
] as const;
export const isFinal = (status: Enrollment['status']): boolean =>
  (FINAL_STATUSES as readonly string[]).includes(status);

interface Props {
  student: Student;
  hasFingerprint: boolean;
  onStudentChanged: () => void;
  /** An enrollment started or ended: the lists should refresh. */
  onEnrollmentChanged: (running: boolean) => void;
}

export function EnrollPanel({
  student,
  hasFingerprint,
  onStudentChanged,
  onEnrollmentChanged,
}: Props) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);

  const running = enrollment !== null && !isFinal(enrollment.status);

  useLiveEvents((event) => {
    if (event.type !== 'enrollment') return;
    if (event.data.enrollmentId !== enrollment?.id) return;
    const { status, step, failureReason } = event.data;
    setEnrollment((current) =>
      current ? { ...current, status, step, failureReason } : current,
    );
    if (isFinal(status)) onEnrollmentChanged(false);
  });

  // After a cut of the stream the events are lost: ask the server where it is.
  const refresh = useCallback(() => {
    if (!enrollment || isFinal(enrollment.status)) return;
    call(
      getApi().client.GET('/enrollments/{id}', {
        params: { path: { id: enrollment.id } },
      }),
    )
      .then((latest) => {
        setEnrollment(latest);
        if (isFinal(latest.status)) onEnrollmentChanged(false);
      })
      .catch((error: unknown) => setFailure(describeError(error)));
  }, [enrollment, onEnrollmentChanged]);
  useResync(refresh);

  const start = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const created = await call(
        getApi().client.POST('/students/{id}/enrollments', {
          params: { path: { id: student.id } },
          body: {},
        }),
      );
      setEnrollment(created);
      onEnrollmentChanged(true);
    } catch (error) {
      // The server is the authority on consent: reload the student so the
      // panel shows the real state instead of an enabled button.
      if (error instanceof ApiError && error.code === 'CONSENT_REQUIRED') {
        onStudentChanged();
      }
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!enrollment) return;
    setBusy(true);
    setFailure(null);
    try {
      const cancelled = await call(
        getApi().client.POST('/enrollments/{id}/cancel', {
          params: { path: { id: enrollment.id } },
        }),
      );
      setEnrollment(cancelled);
      onEnrollmentChanged(false);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = enrollment?.step
    ? ENROLL_STEPS.indexOf(enrollment.step as never)
    : -1;

  return (
    <section className="card stack" aria-label={`Enrolar a ${student.name}`}>
      <h2>Enrolar a {student.name}</h2>
      <p className="muted">Documento {student.document}</p>
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}

      {!student.consented && (
        <Notice
          kind="warning"
          title="Falta el consentimiento"
          actions={
            <button
              type="button"
              className="btn"
              onClick={() => setConsentOpen(true)}
            >
              Registrar consentimiento…
            </button>
          }
        >
          No se puede enrolar la huella sin el consentimiento del estudiante.
        </Notice>
      )}

      {hasFingerprint && !enrollment && (
        <Notice kind="info">
          Este estudiante ya tiene una huella: enrolar de nuevo la reemplaza.
        </Notice>
      )}

      {!enrollment && (
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!student.consented || busy || !student.active}
            onClick={() => void start()}
          >
            Iniciar enrolamiento
          </button>
        </div>
      )}

      {enrollment && (
        <div className="stack" aria-live="polite">
          <div className="row">
            <strong>Estado:</strong>
            <Badge
              tone={
                enrollment.status === 'done'
                  ? 'success'
                  : isFinal(enrollment.status)
                    ? 'danger'
                    : 'info'
              }
            >
              {ENROLL_STATUS_LABELS[enrollment.status] ?? enrollment.status}
            </Badge>
          </div>
          {!isFinal(enrollment.status) && (
            <>
              <p className={styles.instruction} data-testid="enroll-step">
                {enrollment.step
                  ? enrollStepLabel(enrollment.step)
                  : 'Esperando al lector…'}
              </p>
              <ol className={styles.steps}>
                {ENROLL_STEPS.map((step, index) => (
                  <li
                    key={step}
                    aria-current={index === stepIndex ? 'step' : undefined}
                    className={index < stepIndex ? styles.done : undefined}
                  >
                    {enrollStepLabel(step)}
                  </li>
                ))}
              </ol>
              <div>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void cancel()}
                >
                  Cancelar enrolamiento
                </button>
              </div>
            </>
          )}
          {enrollment.status === 'done' && (
            <Notice kind="success" title="Huella registrada">
              {student.name} ya puede marcar con su huella en los horarios a los
              que esté asignado. Se cargará en el lector antes del próximo
              horario.
            </Notice>
          )}
          {enrollment.status === 'failed' && (
            <Notice kind="error" title="El enrolamiento falló">
              {failureLabel(enrollment.failureReason)}
            </Notice>
          )}
          {enrollment.status === 'expired' && (
            <Notice kind="warning" title="Se acabó el tiempo">
              El lector no recibió la huella a tiempo. Puede intentarlo de
              nuevo.
            </Notice>
          )}
          {enrollment.status === 'cancelled' && (
            <Notice kind="info" title="Enrolamiento cancelado" />
          )}
          {isFinal(enrollment.status) && (
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => setEnrollment(null)}
              >
                {enrollment.status === 'done' ? 'Listo' : 'Intentar de nuevo'}
              </button>
            </div>
          )}
        </div>
      )}
      {running && (
        <p className="muted">
          Mientras dure el enrolamiento el lector no registra asistencia.
        </p>
      )}

      <ConsentDialog
        student={consentOpen ? student : null}
        onClose={() => setConsentOpen(false)}
        onRecorded={() => {
          setConsentOpen(false);
          onStudentChanged();
        }}
      />
    </section>
  );
}
