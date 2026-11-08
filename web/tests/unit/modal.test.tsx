import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DatePicker } from '@/ui/DatePicker';
import { FormModal, useModalGuard } from '@/ui/FormModal';
import { Modal } from '@/ui/Modal';
import { ScheduleSelect } from '@/ui/ScheduleSelect';
import { TextField, useForm, FormActions } from '@/ui/Form';
import { useId } from 'react';

function Host({
  busy = false,
  withPickers = false,
}: {
  busy?: boolean;
  withPickers?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState('');
  const [schedule, setSchedule] = useState('');
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <Modal
        open={open}
        title="Un título"
        busy={busy}
        onClose={() => setOpen(false)}
      >
        <input aria-label="Primero" />
        <input aria-label="Segundo" />
        {withPickers && (
          <>
            <DatePicker label="Día" value={day} onChange={setDay} />
            <ScheduleSelect
              label="Horario"
              schedules={[
                {
                  id: 'a',
                  name: 'Mañana',
                  weekday: 1,
                  startTime: '06:00',
                  endTime: '07:00',
                },
              ]}
              value={schedule}
              onChange={setSchedule}
            />
          </>
        )}
        <button type="button" onClick={() => setOpen(false)}>
          Guardar
        </button>
      </Modal>
    </div>
  );
}

const dialogs = () =>
  screen
    .queryAllByRole('dialog')
    .filter((node) => node.getAttribute('aria-modal') === 'true');

describe('Modal (R1-R7)', () => {
  it('is a labelled modal dialog with a visible close button (R1)', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Un título' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('focuses the first field, cycles Tab and returns the focus (R2, R3)', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText('Primero'));
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Guardar' }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cerrar' }),
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Guardar' }),
    );
    await user.keyboard('{Escape}');
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });

  it('closes with Escape and with a click on the backdrop (R4)', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(dialogs()).toHaveLength(0);
  });

  it('does not close when the press started inside and ended on the backdrop', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.pointerDown(screen.getByLabelText('Primero'));
    fireEvent.pointerUp(backdrop);
    expect(dialog.isConnected).toBe(true);
  });

  it('ignores every close request while busy (R7)', async () => {
    const user = userEvent.setup();
    render(<Host busy />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.keyboard('{Escape}');
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Cerrar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('locks the page scroll while open and restores it (R6)', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });
});

function Dirty() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <FormModal open={open} title="Formulario" onClose={() => setOpen(false)}>
        <Inner onCancel={() => setOpen(false)} />
      </FormModal>
    </div>
  );
}

function Inner({ onCancel }: { onCancel: () => void }) {
  const id = useId();
  const form = useForm({
    initial: { name: '' },
    validate: () => ({}),
    onSubmit: () => undefined,
  });
  return (
    <form id={id} onSubmit={form.submit} aria-label="Datos">
      <TextField
        label="Nombre"
        value={form.values.name}
        onChange={(v) => form.setValue('name', v)}
      />
      <FormActions
        formId={id}
        busy={form.submitting}
        submitLabel="Guardar"
        onCancel={onCancel}
      />
    </form>
  );
}

describe('FormModal (R5)', () => {
  it('closes without asking when nothing changed', async () => {
    const user = userEvent.setup();
    render(<Dirty />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.keyboard('{Escape}');
    expect(dialogs()).toHaveLength(0);
  });

  it('asks before discarding on Escape, keeps the data and discards on confirm', async () => {
    const user = userEvent.setup();
    render(<Dirty />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.type(screen.getByLabelText('Nombre'), 'Ana');
    await user.keyboard('{Escape}');
    expect(screen.getByText('¿Descartar los cambios?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe(
      'Ana',
    );
    expect(dialogs()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    expect(dialogs()).toHaveLength(0);
  });

  it('asks on the X and on the backdrop too', async () => {
    const user = userEvent.setup();
    render(<Dirty />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.type(screen.getByLabelText('Nombre'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByText('¿Descartar los cambios?')).toBeTruthy();
    expect(dialogs()).toHaveLength(1);
  });

  it('reports dirty from any content through the guard', async () => {
    function Content() {
      const [text, setText] = useState('');
      useModalGuard(text !== '');
      return (
        <input aria-label="Texto" onChange={(e) => setText(e.target.value)} />
      );
    }
    const user = userEvent.setup();
    render(
      <FormModal open title="Otro" onClose={() => undefined}>
        <Content />
      </FormModal>,
    );
    await user.type(screen.getByLabelText('Texto'), 'x');
    await user.keyboard('{Escape}');
    expect(screen.getByText('¿Descartar los cambios?')).toBeTruthy();
  });
});

describe('Selectors inside a modal (R14-R16)', () => {
  it('Escape closes only the popover; a second one closes the modal (R15)', async () => {
    const user = userEvent.setup();
    render(<Host withPickers />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByLabelText('Día'));
    expect(
      screen.getByRole('dialog', { name: 'Calendario de Día' }),
    ).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(dialogs()).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByLabelText('Día'));
    await user.keyboard('{Escape}');
    expect(dialogs()).toHaveLength(0);
  });

  it('a click inside the modal but outside the popover closes only the popover (R16)', async () => {
    const user = userEvent.setup();
    render(<Host withPickers />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByLabelText('Horario'));
    expect(document.querySelector('body > [role="dialog"]')).toBeTruthy();
    await user.click(screen.getByLabelText('Primero'));
    expect(document.querySelector('body > [role="dialog"]')).toBeNull();
    expect(dialogs()).toHaveLength(1);
  });
});
