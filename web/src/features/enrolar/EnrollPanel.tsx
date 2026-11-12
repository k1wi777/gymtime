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
import { Avatar } from '@/ui/Avatar';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/icons';
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
  // Enrollment whose final notice was closed; a new enrollment shows its own.
  const [closedNoticeId, setClosedNoticeId] = useState<string | null>(null);

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
    <div className={styles.cols}>
      <section
        className={`card ${styles.student}`}
        aria-label={`Enrolar a ${student.name}`}
      >
        <div className={styles.studentHead}>
          <Avatar name={student.name} id={student.id} size={64} fontSize={22} />
          <div className={styles.studentWho}>
            <h2 className={styles.studentName}>{student.name}</h2>
            <div className={styles.studentDoc}>
              Documento {student.document}
            </div>
          </div>
          <span
            className={
              student.consented
                ? `${styles.chip} ${styles.chipOk}`
                : styles.chip
            }
          >
            <Icon
              name={student.consented ? 'check' : 'alertaCirculo'}
              size={13}
              strokeWidth={2.2}
            />
            {student.consented
              ? 'Consentimiento registrado'
              : 'Sin consentimiento'}
          </span>
        </div>
        <div className={styles.studentBody}>
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
                  className="btn btn-primary"
                  onClick={() => setConsentOpen(true)}
                >
                  Registrar consentimiento…
                </button>
              }
            >
              No se puede enrolar la huella sin el consentimiento del
              estudiante.
            </Notice>
          )}

          {hasFingerprint && !enrollment && (
            <Notice kind="info">
              Este estudiante ya tiene una huella: enrolar de nuevo la
              reemplaza.
            </Notice>
          )}

          {running && (
            <p className="muted" style={{ margin: 0 }}>
              Mientras dure el enrolamiento el lector no registra asistencia.
            </p>
          )}
        </div>
      </section>

      <section className={styles.reader} aria-label="Lector">
        <div role="img" aria-label="Huella" className={styles.readerIcon}>
          <Icon name="huella" size={88} strokeWidth={1.4} />
        </div>

        {!enrollment && (
          <>
            <div>
              <h2 className={styles.readerTitle}>Lector en espera</h2>
              <p className={styles.readerText}>
                El estudiante pondrá el dedo, lo retirará y lo pondrá de nuevo.
                Mientras dura, el lector no registra asistencia.
              </p>
            </div>
            <button
              type="button"
              className={`btn btn-primary ${styles.readerButton}`}
              disabled={!student.consented || busy || !student.active}
              onClick={() => void start()}
            >
              Iniciar enrolamiento
            </button>
            {!student.consented && (
              <div className={styles.readerNote}>
                Requiere consentimiento registrado.
              </div>
            )}
          </>
        )}

        {enrollment && (
          <div className={styles.live} aria-live="polite">
            <div className="row" style={{ justifyContent: 'center' }}>
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
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void cancel()}
                >
                  Cancelar enrolamiento
                </button>
              </>
            )}
            {enrollment.status === 'done' &&
              closedNoticeId !== enrollment.id && (
                <div className={styles.wide}>
                  <Notice
                    kind="success"
                    title="Huella registrada"
                    onDismiss={() => setClosedNoticeId(enrollment.id)}
                  >
                    {student.name} ya puede marcar con su huella en los horarios
                    a los que esté asignado. Se cargará en el lector antes del
                    próximo horario.
                  </Notice>
                </div>
              )}
            {enrollment.status === 'failed' &&
              closedNoticeId !== enrollment.id && (
                <div className={styles.wide}>
                  <Notice
                    kind="error"
                    title="El enrolamiento falló"
                    onDismiss={() => setClosedNoticeId(enrollment.id)}
                  >
                    {failureLabel(enrollment.failureReason)}
                  </Notice>
                </div>
              )}
            {enrollment.status === 'expired' &&
              closedNoticeId !== enrollment.id && (
                <div className={styles.wide}>
                  <Notice
                    kind="warning"
                    title="Se acabó el tiempo"
                    onDismiss={() => setClosedNoticeId(enrollment.id)}
                  >
                    El lector no recibió la huella a tiempo. Puede intentarlo de
                    nuevo.
                  </Notice>
                </div>
              )}
            {enrollment.status === 'cancelled' &&
              closedNoticeId !== enrollment.id && (
                <div className={styles.wide}>
                  <Notice
                    kind="info"
                    title="Enrolamiento cancelado"
                    onDismiss={() => setClosedNoticeId(enrollment.id)}
                  />
                </div>
              )}
            {isFinal(enrollment.status) && (
              <button
                type="button"
                className="btn"
                onClick={() => setEnrollment(null)}
              >
                {enrollment.status === 'done' ? 'Listo' : 'Intentar de nuevo'}
              </button>
            )}
          </div>
        )}
      </section>

      <ConsentDialog
        student={consentOpen ? student : null}
        onClose={() => setConsentOpen(false)}
        onRecorded={() => {
          setConsentOpen(false);
          onStudentChanged();
        }}
      />
    </div>
  );
}
