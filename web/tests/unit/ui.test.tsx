import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/api/client';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { DataTable, type Column } from '@/ui/DataTable';
import { SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';

interface Row {
  id: string;
  name: string;
  group: string;
}
const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: String(i),
  name: i === 3 ? 'Álvaro Ruiz' : `Persona ${String(i).padStart(2, '0')}`,
  group: i % 2 === 0 ? 'A' : 'B',
}));
const columns: Column<Row>[] = [
  {
    key: 'name',
    header: 'Nombre',
    render: (r) => r.name,
    sortValue: (r) => r.name,
  },
  { key: 'group', header: 'Grupo', render: (r) => r.group },
];

const table = (
  props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {},
) => (
  <DataTable<Row>
    caption="Personas"
    columns={columns}
    rows={rows}
    rowKey={(r) => r.id}
    searchText={(r) => r.name}
    selects={[
      {
        id: 'group',
        label: 'Grupo',
        options: [
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B' },
        ],
        matches: (r, v) => r.group === v,
      },
    ]}
    {...props}
  />
);

describe('DataTable (R13)', () => {
  it('paginates ten rows at a time', async () => {
    const user = userEvent.setup();
    render(table());
    expect(screen.getAllByRole('row')).toHaveLength(11); // header + 10
    expect(screen.getByText('Página 1 de 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Página 2 de 3')).toBeTruthy();
    expect(screen.getByText('Persona 10')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(screen.getByText('Persona 00')).toBeTruthy();
  });

  it('filters by text ignoring accents and case, and returns to page 1', async () => {
    const user = userEvent.setup();
    render(table());
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.type(screen.getByLabelText('Buscar'), 'alvaro');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Álvaro Ruiz')).toBeTruthy();
  });

  it('filters with a select', async () => {
    const user = userEvent.setup();
    render(table());
    await user.selectOptions(screen.getByLabelText('Grupo'), 'B');
    const body = screen.getAllByRole('row').slice(1);
    for (const row of body) expect(within(row).getByText('B')).toBeTruthy();
  });

  it('sorts a sortable column both ways', async () => {
    const user = userEvent.setup();
    render(table({ rows: rows.slice(0, 3) }));
    await user.click(screen.getByRole('button', { name: /Nombre/ }));
    await user.click(screen.getByRole('button', { name: /Nombre/ }));
    const first = screen.getAllByRole('row')[1];
    expect(first && within(first).getByText('Persona 02')).toBeTruthy();
  });

  it('shows the empty, loading and error states', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      table({ rows: [], emptyMessage: 'Nada por aquí.' }),
    );
    expect(screen.getByText('Nada por aquí.')).toBeTruthy();
    rerender(table({ rows: undefined, loading: true }));
    expect(screen.getByRole('status').textContent).toContain('Cargando');
    rerender(table({ error: new ApiError(0, 'NETWORK', 'x'), onRetry: retry }));
    expect(screen.getByRole('alert').textContent).toContain('No hay conexión');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalled();
  });
});

function Demo({ onSubmit }: { onSubmit: (v: { name: string }) => void }) {
  const form = useForm({
    initial: { name: '' },
    validate: (v) => (v.name.trim() === '' ? { name: 'Falta el nombre.' } : {}),
    onSubmit,
  });
  return (
    <form onSubmit={form.submit} noValidate>
      <TextField
        label="Nombre"
        value={form.values.name}
        onChange={(v) => form.setValue('name', v)}
        onBlur={() => form.blur('name')}
        error={form.errors.name}
        help="Ayuda"
      />
      <button
        type="button"
        onClick={() => form.setServerErrors({ name: 'Ya existe.' })}
      >
        servidor
      </button>
      <SubmitButton busy={form.submitting}>Guardar</SubmitButton>
    </form>
  );
}

describe('Form (R13)', () => {
  it('shows the error on blur, links it to the input and clears it when fixed', async () => {
    const user = userEvent.setup();
    render(<Demo onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Nombre');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(input);
    await user.tab();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Falta el nombre.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    await user.type(input, 'Ana');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not submit with errors and submits with valid data', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Demo onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Falta el nombre.');
    await user.type(screen.getByLabelText('Nombre'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ana' });
  });

  it('places a server validation message on the field', async () => {
    const user = userEvent.setup();
    render(<Demo onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'servidor' }));
    expect(screen.getByRole('alert').textContent).toBe('Ya existe.');
  });
});

describe('ConfirmDialog and Notice (R13)', () => {
  it('confirms and cancels, and does not render its content while closed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open={false}
        title="¿Seguro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        Detalle
      </ConfirmDialog>,
    );
    expect(screen.queryByText('Detalle')).toBeNull();
    rerender(
      <ConfirmDialog
        open
        title="¿Seguro?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        Detalle
      </ConfirmDialog>,
    );
    expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true);
    expect(screen.getByText('Detalle')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('can disable the confirmation until a condition holds', () => {
    render(
      <ConfirmDialog
        open
        title="t"
        confirmDisabled
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('announces errors at once and the rest politely', () => {
    render(
      <>
        <Notice kind="error">Falló</Notice>
        <Notice kind="success">Listo</Notice>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Falló');
    expect(screen.getByRole('status').textContent).toBe('Listo');
  });
});
