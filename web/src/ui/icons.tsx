import type { ReactNode, SVGProps } from 'react';

/**
 * Icon paths copied from the approved design boards (24x24 grid, stroke
 * `currentColor`). Each icon is a list of `d` attributes; the ones marked
 * "own" are not in the boards (the administrator entries) and follow the
 * same style.
 */
const PATHS = {
  ahora: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  registro: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  revisar: [
    'M9 11l3 3 8-8',
    'M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9',
  ],
  huella: [
    'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4',
    'M14 13.12c0 2.38 0 6.38-1 8.88',
    'M17.29 21.02c.12-.6.43-2.3.5-3.02',
    'M2 12a10 10 0 0 1 18-6',
    'M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2',
    'M8.65 22c.21-.66.45-1.32.57-2',
    'M9 6.8a6 6 0 0 1 9 5.2v2',
    'M21.8 16c.2-2 .131-5.354 0-6',
  ],
  campana: [
    'M10.268 21a2 2 0 0 0 3.464 0',
    'M22 8c0-2.3-.8-4.3-2-6',
    'M4 2C2.8 3.7 2 5.7 2 8',
    'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
  ],
  dispositivo: [
    'M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
    'M9 21h6',
  ],
  lector: [
    'M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
    'M9 21h6M12 18v3',
    'M8 10h4M8 13h8',
  ],
  horarios: [
    'M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M4 10h16M9 3v4M15 3v4',
  ],
  ojo: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z'],
  candado: ['M8 10V7a4 4 0 0 1 8 0v3'],
  check: ['M5 12l5 5 9-10'],
  entrada: ['M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4'],
  salida: ['M14 7l-5 5 5 5M9 12h12M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4'],
  buscar: ['M20 20l-4-4'],
  alertaCirculo: ['M12 8v5M12 17v.01'],
  alertaTriangulo: ['M12 3l10 18H2L12 3z', 'M12 10v4M12 17.5v.01'],
  // administrator menu (paths of the approved boards)
  resumen: ['M3 3h7v9H3zM14 3h7v5h-7z', 'M14 12h7v9h-7zM3 16h7v5H3z'],
  reportes: ['M4 20V10M10 20V4M16 20v-7', 'M2 20h20'],
  periodos: ['M3 12h18', 'M7 8l-4 4 4 4M17 8l4 4-4 4'],
  gestionHorarios: [
    'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0',
    'M14 4v4M8 10v4M16 16v4',
  ],
  estudiantes: [
    'M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1',
    'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8',
  ],
  historial: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5M12 7v5l3 2'],
  auditoria: [
    'M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z',
    'M9 12l2 2 4-4',
  ],
  usuarios: [
    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  ],
  // arrows and actions of the boards
  chevron: ['M9 6l6 6-6 6'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  flecha: ['M5 12h14M13 6l6 6-6 6'],
  descargar: ['M12 4v11M7 10l5 5 5-5M5 20h14'],
  subir: ['M12 15V4M7 9l5-5 5 5M5 20h14'],
  mas: ['M12 5v14M5 12h14'],
  calendario: [
    'M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M4 10h16M9 3v4M15 3v4',
  ],
} as const;

/** Shapes that are not paths (circles and rectangles of some icons). */
const EXTRA: Partial<Record<IconName, ReactNode>> = {
  ojo: <circle cx="12" cy="12" r="3" />,
  candado: <rect x="4" y="10" width="16" height="10" rx="2" />,
  buscar: <circle cx="11" cy="11" r="7" />,
  alertaCirculo: <circle cx="12" cy="12" r="9" />,
};

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

/** Decorative icon (`aria-hidden`): the text next to it carries the meaning. */
export function Icon({
  name,
  size = 19,
  strokeWidth = 1.8,
  ...rest
}: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
      {EXTRA[name]}
    </svg>
  );
}
