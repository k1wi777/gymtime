'use client';

import { useLive } from '@/live/live-provider';
import { Badge, type BadgeTone } from '@/ui/Badge';

const LABELS = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  disconnected: 'Desconectado',
} as const;

const TONES: Record<keyof typeof LABELS, BadgeTone> = {
  connecting: 'neutral',
  connected: 'success',
  reconnecting: 'warning',
  disconnected: 'danger',
};

/** State of the live link; the «Ahora» screen only stays current while connected. */
export function ConnectionBadge() {
  const { state } = useLive();
  return (
    <span title="Estado de la conexión en vivo con el servidor">
      <span className="visually-hidden">Conexión en vivo: </span>
      <Badge tone={TONES[state]}>{LABELS[state]}</Badge>
    </span>
  );
}
