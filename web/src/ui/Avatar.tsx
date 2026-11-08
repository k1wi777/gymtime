import { avatarTone, initialsOf } from '@/lib/display';
import styles from './Avatar.module.css';

/** Circle with the initials of a person; the color is stable per `id`. */
export function Avatar({
  name,
  id,
  size = 40,
  fontSize = 14,
}: {
  name: string;
  id: string;
  size?: number;
  fontSize?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`${styles.avatar} ${styles[`t${avatarTone(id)}`]}`}
      style={{ width: size, height: size, fontSize }}
    >
      {initialsOf(name)}
    </div>
  );
}
