'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { NAV_GROUPS, type NavGroup, type NavItem } from '@/lib/nav';
import { Icon } from '@/ui/icons';
import styles from './NavGroups.module.css';

const REVIEW_HREF = '/por-revisar';

const isActive = (pathname: string, item: NavItem): boolean =>
  pathname.startsWith(item.href);

type OpenState = Record<NavGroup, boolean>;

const onlyActive = (pathname: string, items: readonly NavItem[]): OpenState => {
  const active = items.find((item) => isActive(pathname, item))?.group;
  return {
    Operación: active === 'Operación',
    Control: active === 'Control',
    Administración: active === 'Administración',
  };
};

interface Props {
  items: readonly NavItem[];
  pathname: string;
  /** Items waiting for review, shown next to «Por revisar». */
  pending: number;
  /**
   * Administrator: each group is a button that opens or closes it. The
   * assistant keeps the static group titles.
   */
  collapsible: boolean;
}

/**
 * Side menu groups. With `collapsible`, only the group of the current route
 * starts open, and the route's group is forced open when navigating so the
 * current page is never hidden. The state is not persisted on purpose.
 */
export function NavGroups({ items, pathname, pending, collapsible }: Props) {
  const baseId = useId();
  const [open, setOpen] = useState<OpenState>(() =>
    onlyActive(pathname, items),
  );

  // Depends on the group (a stable string), not on the identity of `items`,
  // so live re-renders never reopen a group the user closed.
  const activeGroup = items.find((item) => isActive(pathname, item))?.group;
  useEffect(() => {
    if (activeGroup)
      setOpen((current) => ({ ...current, [activeGroup]: true }));
  }, [activeGroup, pathname]);

  return (
    <>
      {NAV_GROUPS.map((group) => {
        const inGroup = items.filter((item) => item.group === group);
        if (inGroup.length === 0) return null;
        const expanded = !collapsible || open[group];
        const panelId = `${baseId}-${group}`;
        const hasReview = inGroup.some((item) => item.href === REVIEW_HREF);
        return (
          <div key={group} className={styles.group}>
            {collapsible ? (
              <button
                type="button"
                className={styles.toggle}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() =>
                  setOpen((current) => ({
                    ...current,
                    [group]: !current[group],
                  }))
                }
              >
                <span className={styles.toggleTitle}>{group}</span>
                {!expanded && hasReview && pending > 0 && (
                  <span
                    className={styles.groupCounter}
                    aria-label={`${pending} por revisar`}
                  >
                    {pending}
                  </span>
                )}
                <Icon
                  name="chevronDown"
                  size={16}
                  strokeWidth={2}
                  className={expanded ? styles.arrow : styles.arrowClosed}
                />
              </button>
            ) : (
              <div className={styles.groupTitle}>{group}</div>
            )}
            <div id={panelId} hidden={!expanded} className={styles.items}>
              {inGroup.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(pathname, item) ? 'page' : undefined}
                  className={styles.link}
                >
                  <Icon name={item.icon} />
                  <span className={styles.label}>{item.label}</span>
                  {item.href === REVIEW_HREF && pending > 0 && expanded && (
                    <span
                      className={styles.counter}
                      aria-label={`${pending} por revisar`}
                    >
                      {pending}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
