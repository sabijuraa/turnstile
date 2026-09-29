"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icon";
import styles from "./Toast.module.css";

export type ToastTone = "positive" | "critical" | "info";

export interface ToastInput {
  tone: ToastTone;
  /** Use the same words as the button that caused it, for example "Session key revoked". */
  title: string;
  body?: string;
  /** Milliseconds before it dismisses itself. Critical toasts stay until closed. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider above it in the tree");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { ...toast, id }]);
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className={styles.region} aria-label="Notifications">
        <ol className={styles.stack} aria-live="polite" aria-relevant="additions">
          {items.map((item) => (
            <ToastView key={item.id} item={item} onClose={() => dismiss(item.id)} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const duration = item.duration ?? (item.tone === "critical" ? 0 : 5000);

  useEffect(() => {
    if (paused || duration <= 0) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [paused, duration, onClose]);

  return (
    <li
      className={`${styles.toast} ${styles[item.tone]}`}
      role={item.tone === "critical" ? "alert" : undefined}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon
        name={item.tone === "critical" ? "alert" : item.tone === "positive" ? "check" : "info"}
        size={18}
        className={styles.icon}
      />
      <div className={styles.body}>
        <p className={styles.title}>{item.title}</p>
        {item.body ? <p className={styles.text}>{item.body}</p> : null}
      </div>
      <button type="button" className={styles.close} onClick={onClose}>
        <Icon name="close" size={16} />
        <span className="visually-hidden">Dismiss notification</span>
      </button>
    </li>
  );
}
