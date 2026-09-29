import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "md" | "sm";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon shown after the label. */
  icon?: IconName;
  /** Icon shown before the label. */
  leadingIcon?: IconName;
  children: ReactNode;
}

export interface ButtonProps
  extends CommonProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Shows a spinner, keeps the width, and blocks repeat presses. */
  loading?: boolean;
  /** Label announced while loading, for example "Saving policy". */
  loadingLabel?: string;
}

export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return [styles.button, styles[variant], styles[size], extra].filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  leadingIcon,
  loading = false,
  loadingLabel,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      <span className={styles.content}>
        {leadingIcon ? <Icon name={leadingIcon} size={size === "sm" ? 16 : 18} /> : null}
        <span>{children}</span>
        {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} className={styles.trail} /> : null}
      </span>
      {loading ? (
        <span className={styles.spinnerWrap}>
          <span className={styles.spinner} aria-hidden="true" />
          <span className="visually-hidden">{loadingLabel ?? "Working"}</span>
        </span>
      ) : null}
    </button>
  );
}

export interface ButtonLinkProps
  extends CommonProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href"> {
  href: string;
}

/** A link styled as a button. Use it when the action navigates. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  icon,
  leadingIcon,
  href,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const external = /^https?:\/\//.test(href);
  const content = (
    <span className={styles.content}>
      {leadingIcon ? <Icon name={leadingIcon} size={size === "sm" ? 16 : 18} /> : null}
      <span>{children}</span>
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} className={styles.trail} /> : null}
    </span>
  );
  if (external) {
    return (
      <a
        href={href}
        className={buttonClassName(variant, size, className)}
        rel="noreferrer"
        {...rest}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClassName(variant, size, className)} {...rest}>
      {content}
    </Link>
  );
}
