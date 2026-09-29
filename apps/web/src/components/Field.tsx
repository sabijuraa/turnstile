import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from "react";
import styles from "./Field.module.css";
import { Icon } from "./Icon";

interface ControlA11yProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  required?: boolean;
}

export interface FieldProps {
  label: string;
  /** One line that helps the person fill the field in. */
  help?: ReactNode;
  /** Inline error. Say what is wrong and what to do next. */
  error?: string;
  /** Text after the label, for example "Optional". */
  hint?: string;
  required?: boolean;
  /** The control. Field wires its id, description and invalid state. */
  children: ReactElement<ControlA11yProps>;
}

/** Label, control, help text and inline error, wired together for assistive tech. */
export function Field({ label, help, error, hint, required, children }: FieldProps) {
  const autoId = useId();
  const controlId = children.props.id ?? `field-${autoId}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, helpId, children.props["aria-describedby"]]
    .filter(Boolean)
    .join(" ");
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
        required: required ?? children.props.required,
      })
    : children;
  return (
    <div className={styles.field} data-invalid={error ? true : undefined}>
      <label htmlFor={controlId} className={styles.label}>
        {label}
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </label>
      {control}
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Text or unit fixed after the value, for example "USDC". */
  suffix?: string;
  /** Uses the mono family with tabular figures, for amounts and addresses. */
  mono?: boolean;
}

export function Input({ suffix, mono = false, className, ...rest }: InputProps) {
  const input = (
    <input
      className={[styles.input, mono ? styles.mono : "", className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
  if (!suffix) return input;
  return (
    <span className={styles.affix}>
      {input}
      <span className={styles.suffix} aria-hidden="true">
        {suffix}
      </span>
    </span>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={[styles.input, styles.textarea, className].join(" ")} {...rest} />;
}
