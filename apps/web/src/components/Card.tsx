import type { ElementType, ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps {
  as?: ElementType;
  /** `flat` sits on a hairline. `raised` floats with a soft shadow and is for things that land or overlay. */
  elevation?: "flat" | "raised";
  padding?: "md" | "lg" | "none";
  className?: string;
  children: ReactNode;
}

export function Card({
  as: Tag = "div",
  elevation = "flat",
  padding = "md",
  className,
  children,
}: CardProps) {
  return (
    <Tag
      className={[styles.card, styles[elevation], styles[`pad-${padding}`], className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Tag>
  );
}
