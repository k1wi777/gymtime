import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Student } from '@/api/types';
import { StudentSearch } from '@/features/students/StudentSearch';
import { Modal } from '@/ui/Modal';

const make = (id: string, name: string, document: string): Student => ({
  id,
  name,
  document,
  active: true,
  consented: true,
  displayName: name,
  email: null,
  phone: null,
  program: 'Derecho',
  anonymizedAt: null,
  consentAt: null,
  consentVersion: null,
});

const students = [
  make('a', 'María Pérez', '1.067.111'),
  make('b', 'Mario Soto', '1022'),
  make('c', 'Luis Mora', '1033'),
];

describe('StudentSearch (R1, R8)', () => {
  it('lists nothing until typing, then matches without accents or case', async () => {
    const user = userEvent.setup();
    render(<StudentSearch students={students} onSelect={() => {}} />);
    const box = screen.getByRole('combobox');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    await user.type(box, 'MARÍA');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('1 coincidencia')).toBeTruthy();
    await user.clear(box);
    await user.type(box, 'mar');
    expect(screen.getByText('2 coincidencias')).toBeTruthy();
  });

  it('matches by document ignoring dots and highlights the name match', async () => {
    const user = userEvent.setup();
    render(<StudentSearch students={students} onSelect={() => {}} />);
    await user.type(screen.getByRole('combobox'), '1067');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'lui');
    expect(screen.getByRole('option').querySelector('mark')?.textContent).toBe(
      'Lui',
    );
  });

  it('picks with the arrow keys and Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<StudentSearch students={students} onSelect={onSelect} />);
    await user.type(screen.getByRole('combobox'), 'mar');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(students[1]);
  });

  it('does not pick a disabled row and shows its status', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <StudentSearch
        students={students}
        onSelect={onSelect}
        statusOf={() => ({ label: 'Ya está en este horario', disabled: true })}
      />,
    );
    await user.type(screen.getByRole('combobox'), 'luis');
    await user.click(screen.getByRole('option'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('Ya está en este horario')).toBeTruthy();
  });

  it('closes only the list on Escape, not the modal around it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="Buscar" onClose={onClose}>
        <StudentSearch students={students} onSelect={() => {}} />
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'mar');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
