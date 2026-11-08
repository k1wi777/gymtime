'use client';

import { createPortal } from 'react-dom';
import {
  useCallback,
  useId,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { FieldErrors } from '@/lib/validators';
import { useCloseRequest, useModalGuard } from './FormModal';
import { useModalFooter } from './Modal';
import styles from './Form.module.css';

interface FieldFrameProps {
  id: string;
  label: string;
  error?: string | undefined;
  help?: string | undefined;
  children: ReactNode;
}

export function FieldFrame({
  id,
  label,
  error,
  help,
  children,
}: FieldFrameProps) {
  return (
    <div className={styles.field}>
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      {children}
      {help && !error && (
        <p id={`${id}-help`} className={styles.help}>
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const describedBy = (id: string, error?: string, help?: string) =>
  error ? `${id}-error` : help ? `${id}-help` : undefined;

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | undefined;
  help?: string | undefined;
  type?: 'text' | 'password' | 'search';
  autoComplete?: string;
  maxLength?: number;
  name?: string;
  disabled?: boolean;
  /** Control drawn over the end of the input (for example show/hide). */
  trailing?: ReactNode;
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  help,
  type = 'text',
  autoComplete,
  maxLength,
  name,
  disabled,
  trailing,
}: TextFieldProps) {
  const id = useId();
  const input = (
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      autoComplete={autoComplete}
      maxLength={maxLength}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, error, help)}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange(event.target.value)
      }
      onBlur={onBlur}
      className={styles.input}
    />
  );
  return (
    <FieldFrame id={id} label={label} error={error} help={help}>
      {trailing ? (
        <div className={styles.control}>
          {input}
          {trailing}
        </div>
      ) : (
        input
      )}
    </FieldFrame>
  );
}

interface TextAreaFieldProps extends Omit<TextFieldProps, 'type'> {
  rows?: number;
}

export function TextAreaField({
  label,
  value,
  onChange,
  onBlur,
  error,
  help,
  rows = 3,
  maxLength,
  disabled,
}: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} help={help}>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, help)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={styles.input}
      />
    </FieldFrame>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  error?: string | undefined;
  help?: string | undefined;
  onBlur?: () => void;
  disabled?: boolean;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  help,
  onBlur,
  disabled,
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} help={help}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, help)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={styles.input}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

export function SubmitButton({
  busy,
  children,
  disabled,
  form,
}: {
  busy: boolean;
  children: ReactNode;
  disabled?: boolean;
  /** Id of the `<form>` when the button sits outside it (a modal footer). */
  form?: string;
}) {
  return (
    <button
      type="submit"
      form={form}
      className="btn btn-primary"
      disabled={busy || disabled}
    >
      {busy ? 'Un momento…' : children}
    </button>
  );
}

/**
 * «Guardar» + «Cancelar» of a form. Inside a modal they go to its fixed footer
 * (tied to the form by `formId`) and «Cancelar» asks before discarding changes.
 */
export function FormActions({
  formId,
  busy,
  submitLabel,
  onCancel,
  className = 'row',
}: {
  formId: string;
  busy: boolean;
  submitLabel: ReactNode;
  onCancel: () => void;
  className?: string;
}) {
  const footer = useModalFooter();
  const requestClose = useCloseRequest();
  const content = (
    <div className={className}>
      <SubmitButton busy={busy} form={formId}>
        {submitLabel}
      </SubmitButton>
      <button
        type="button"
        className="btn"
        disabled={busy && footer !== null}
        onClick={requestClose ?? onCancel}
      >
        Cancelar
      </button>
    </div>
  );
  return footer ? createPortal(content, footer) : content;
}

interface UseFormOptions<T extends object> {
  initial: T;
  validate: (values: T) => FieldErrors<T>;
  onSubmit: (values: T) => Promise<void> | void;
}

/**
 * Small form state: errors show on blur and on submit, a submit with errors
 * never reaches `onSubmit`, and `setServerErrors` places the server's own
 * validation messages on the fields.
 */
export function useForm<T extends object>({
  initial,
  validate,
  onSubmit,
}: UseFormOptions<T>) {
  const [values, setValues] = useState<T>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors<T>>({});
  const [submitting, setSubmitting] = useState(false);

  const clientErrors = validate(values);
  const errors: FieldErrors<T> = {};
  for (const key of Object.keys(clientErrors) as Array<keyof T>) {
    if (touched[key]) errors[key] = clientErrors[key];
  }
  for (const key of Object.keys(serverErrors) as Array<keyof T>) {
    errors[key] ??= serverErrors[key];
  }

  const setValue = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest as FieldErrors<T>;
    });
  }, []);

  const blur = useCallback(
    (key: keyof T) => setTouched((current) => ({ ...current, [key]: true })),
    [],
  );

  /** Empties a field without flagging it as an error (e.g. a wrong password). */
  const clearField = useCallback(<K extends keyof T>(key: K, empty: T[K]) => {
    setValues((current) => ({ ...current, [key]: empty }));
    setTouched((current) => ({ ...current, [key]: false }));
  }, []);

  const reset = useCallback(() => {
    setValues(initial);
    setTouched({});
    setServerErrors({});
  }, [initial]);

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    setTouched(
      Object.fromEntries(
        Object.keys(values).map((key) => [key, true]),
      ) as Partial<Record<keyof T, boolean>>,
    );
    if (Object.keys(validate(values)).length > 0) return;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  const dirty = (Object.keys(initial) as Array<keyof T>).some(
    (key) => values[key] !== initial[key],
  );
  useModalGuard(dirty, submitting);

  return {
    values,
    errors,
    submitting,
    dirty,
    setValue,
    blur,
    clearField,
    reset,
    submit,
    setServerErrors,
  };
}
