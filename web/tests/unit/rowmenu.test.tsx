import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowMenu } from '@/features/admin/RowMenu';

describe('RowMenu', () => {
  const setup = () => {
    const baja = vi.fn();
    const suprimir = vi.fn();
    render(
      <div>
        <p>fuera</p>
        <RowMenu
          label="Más acciones de Ana"
          items={[
            { key: 'baja', label: 'Dar de baja', onSelect: baja },
            {
              key: 'sup',
              label: 'Suprimir datos…',
              danger: true,
              onSelect: suprimir,
            },
          ]}
        />
      </div>,
    );
    return { baja, suprimir };
  };

  it('opens from the button and runs the chosen action, then closes', async () => {
    const user = userEvent.setup();
    const { baja } = setup();
    const button = screen.getByRole('button', { name: 'Más acciones de Ana' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    await user.click(screen.getByRole('menuitem', { name: 'Dar de baja' }));
    expect(baja).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes with Escape and returns the focus to the button', async () => {
    const user = userEvent.setup();
    setup();
    const button = screen.getByRole('button', { name: 'Más acciones de Ana' });
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes with a click outside without running anything', async () => {
    const user = userEvent.setup();
    const { baja, suprimir } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Más acciones de Ana' }),
    );
    await user.click(screen.getByText('fuera'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(baja).not.toHaveBeenCalled();
    expect(suprimir).not.toHaveBeenCalled();
  });

  it('moves between the actions with the arrows', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(
      screen.getByRole('button', { name: 'Más acciones de Ana' }),
    );
    const [first, second] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(first);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
  });
});
