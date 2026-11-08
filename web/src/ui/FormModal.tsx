'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';

interface ModalGuard {
  report: (state: { dirty: boolean; busy: boolean }) => void;
}

const GuardContext = createContext<ModalGuard | null>(null);

/**
 * Lets a form (or any content) tell its modal whether it has unsaved changes
 * and whether it is saving. A no-op outside a `FormModal`.
 */
export function useModalGuard(dirty: boolean, busy = false): void {
  const guard = useContext(GuardContext);
  useEffect(() => {
    guard?.report({ dirty, busy });
  }, [guard, dirty, busy]);
  useEffect(() => () => guard?.report({ dirty: false, busy: false }), [guard]);
}

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  size?: 'md' | 'lg';
  children: ReactNode;
}

/**
 * A `Modal` that asks before discarding unsaved changes: Escape, the backdrop,
 * «Cancelar» and the X all go through `onClose` of the form content, here
 * guarded by a confirmation when the content reports it is dirty.
 */
export function FormModal({ open, title, onClose, size, children }: Props) {
  const [state, setState] = useState({ dirty: false, busy: false });
  const [asking, setAsking] = useState(false);
  const guard = useMemo<ModalGuard>(() => ({ report: setState }), []);

  const request = useCallback(() => {
    if (state.busy) return;
    if (state.dirty) setAsking(true);
    else onClose();
  }, [state, onClose]);

  return (
    <Modal
      open={open}
      title={title}
      size={size}
      busy={state.busy}
      onClose={request}
    >
      <GuardContext.Provider value={guard}>
        <CloseRequest.Provider value={request}>
          {children}
        </CloseRequest.Provider>
      </GuardContext.Provider>
      <ConfirmDialog
        open={asking}
        title="¿Descartar los cambios?"
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        tone="danger"
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onClose();
        }}
      >
        <p>Hay cambios sin guardar. Si cierra ahora, se perderán.</p>
      </ConfirmDialog>
    </Modal>
  );
}

const CloseRequest = createContext<(() => void) | null>(null);

/** The guarded close of the enclosing `FormModal`, for «Cancelar». */
export const useCloseRequest = (): (() => void) | null =>
  useContext(CloseRequest);
