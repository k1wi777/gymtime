import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
  NOTICE_DURATIONS,
  NOTICE_MAX_MS,
  NOTICE_MS_PER_CHAR,
  Notice,
  noticeDuration,
} from '@/ui/Notice';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('Notice auto-close (R1-R10)', () => {
  it('closes after the time of its kind, longer for warnings', () => {
    const success = vi.fn();
    const warning = vi.fn();
    render(
      <>
        <Notice kind="success" onDismiss={success}>
          Listo
        </Notice>
        <Notice kind="warning" onDismiss={warning}>
          Ojo
        </Notice>
      </>,
    );
    tick(NOTICE_DURATIONS.success - 1);
    expect(success).not.toHaveBeenCalled();
    tick(1);
    expect(success).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
    tick(NOTICE_DURATIONS.warning - NOTICE_DURATIONS.success);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it('lengthens the time for long text, with a ceiling', () => {
    expect(noticeDuration('success', undefined, true, 80)).toBe(5_000);
    expect(noticeDuration('success', undefined, true, 130)).toBe(
      5_000 + 50 * NOTICE_MS_PER_CHAR,
    );
    expect(noticeDuration('warning', undefined, true, 5_000)).toBe(
      NOTICE_MAX_MS,
    );
  });

  it('honors an own duration', () => {
    const onDismiss = vi.fn();
    render(
      <Notice kind="success" autoClose={1_000} onDismiss={onDismiss}>
        Rápido
      </Notice>,
    );
    tick(1_000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('never closes errors, notices without onDismiss or with autoClose=false', () => {
    const onDismiss = vi.fn();
    const persistent = vi.fn();
    render(
      <>
        <Notice kind="error" autoClose onDismiss={onDismiss}>
          Falló
        </Notice>
        <Notice kind="info">Sin callback</Notice>
        <Notice kind="warning" autoClose={false} onDismiss={persistent}>
          Estado
        </Notice>
      </>,
    );
    tick(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(persistent).not.toHaveBeenCalled();
    expect(screen.getByText('Sin callback')).toBeTruthy();
    expect(screen.queryAllByTestId('notice-progress')).toHaveLength(0);
  });

  it('shows a progress bar only while it can close by itself', () => {
    render(
      <Notice kind="success" onDismiss={() => undefined}>
        Listo
      </Notice>,
    );
    const bar = screen.getByTestId('notice-progress');
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.style.animationDuration).toBe('5000ms');
    expect(bar.style.animationPlayState).toBe('running');
  });

  it('pauses on hover and resumes with the remaining time', () => {
    const onDismiss = vi.fn();
    render(
      <Notice kind="success" onDismiss={onDismiss}>
        Listo
      </Notice>,
    );
    const notice = screen.getByRole('status');
    tick(3_000);
    fireEvent.mouseEnter(notice);
    expect(screen.getByTestId('notice-progress').style.animationPlayState).toBe(
      'paused',
    );
    tick(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(notice);
    tick(1_999);
    expect(onDismiss).not.toHaveBeenCalled();
    tick(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pauses while the focus is inside and resumes when it leaves', () => {
    const onDismiss = vi.fn();
    render(
      <Notice kind="info" onDismiss={onDismiss}>
        Info
      </Notice>,
    );
    const notice = screen.getByRole('status');
    fireEvent.focus(screen.getByRole('button', { name: 'Cerrar aviso' }));
    tick(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.blur(notice, { relatedTarget: document.body });
    tick(NOTICE_DURATIONS.info);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes at once with the button and cancels the timer', () => {
    const onDismiss = vi.fn();
    render(
      <Notice kind="success" onDismiss={onDismiss}>
        Listo
      </Notice>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    tick(60_000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown when the message changes', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Notice kind="success" onDismiss={onDismiss}>
        Uno
      </Notice>,
    );
    tick(4_000);
    rerender(
      <Notice kind="success" onDismiss={onDismiss}>
        Dos
      </Notice>,
    );
    tick(4_000);
    expect(onDismiss).not.toHaveBeenCalled();
    tick(1_000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('still closes with reduced motion (the timer is not the animation)', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: true, media: query }) as MediaQueryList,
    );
    const onDismiss = vi.fn();
    render(
      <Notice kind="success" onDismiss={onDismiss}>
        Listo
      </Notice>,
    );
    tick(NOTICE_DURATIONS.success);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('unmounts through a controlling parent', () => {
    function Parent() {
      const [shown, setShown] = useState(true);
      return shown ? (
        <Notice kind="success" onDismiss={() => setShown(false)}>
          Hecho
        </Notice>
      ) : null;
    }
    render(<Parent />);
    tick(NOTICE_DURATIONS.success);
    expect(screen.queryByText('Hecho')).toBeNull();
  });
});
