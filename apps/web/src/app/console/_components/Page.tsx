import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { Icon, type IconName } from "@/components/Icon";
import { InlineStatus } from "@/components/InlineStatus";
import { errorMessage } from "@/lib/console/api";
import styles from "./console.module.css";

export function PageHeader({
  title,
  lead,
  actions,
  back,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className={styles.pageHead}>
      <div className={styles.pageTitleBlock}>
        {back ? (
          <Link href={back.href} className={styles.crumb}>
            <Icon name="arrowRight" size={16} />
            {back.label}
          </Link>
        ) : null}
        <h1 className={styles.pageTitle}>{title}</h1>
        {lead ? <p className={styles.pageLead}>{lead}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}

export function ConsoleSection({
  title,
  note,
  action,
  children,
  id,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={styles.section} aria-labelledby={headingId} id={id}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle} id={headingId}>
            {title}
          </h2>
          {note ? <p className={styles.sectionNote}>{note}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={20} />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyText}>{children}</p>
      {action}
    </div>
  );
}

/** The designed empty state that points at creating the first agent. */
export function FirstAgentAction({ label = "Create your first agent" }: { label?: string }) {
  return (
    <ButtonLink href="/console/agents/new" size="sm" leadingIcon="agent">
      {label}
    </ButtonLink>
  );
}

export function LoadError({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <InlineStatus
      tone="critical"
      title={`${what} could not load`}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorMessage(error)}
    </InlineStatus>
  );
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  style,
}: {
  width?: string;
  height?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={styles.skeleton} style={{ width, height, ...style }} aria-hidden="true" />
  );
}

/** A block of skeleton rows that reserves the height of the content on its way. */
export function SkeletonRows({ rows, height = "3.25rem" }: { rows: number; height?: string }) {
  return (
    <div style={{ display: "grid", gap: "1px" }} aria-busy="true">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}
