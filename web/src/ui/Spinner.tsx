import styles from './Spinner.module.css';

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <output className={styles.wrap}>
      <span className={styles.dot} aria-hidden="true" />
      <span>{label}</span>
    </output>
  );
}
