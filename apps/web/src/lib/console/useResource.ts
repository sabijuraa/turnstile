"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isUnauthenticated } from "./api";

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** True until the first answer arrives. */
  loading: boolean;
  /** True while any request is in flight, including a refresh that keeps the old data. */
  refreshing: boolean;
  reload: () => void;
}

/** Sends people whose session ended back to sign in, keeping where they were. */
export function redirectToSignIn(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/signin?next=${encodeURIComponent(next)}`);
}

/**
 * Loads one backend path and keeps the previous data while a new path or a reload is in flight,
 * so the frame holds instead of flashing. A null path waits.
 */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const loaded = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the reload trigger
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setPending(true);
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        loaded.current = true;
        setData(value);
        setError(null);
        setPending(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (isUnauthenticated(err)) {
          redirectToSignIn();
          return;
        }
        setError(err);
        setPending(false);
      });
    return () => controller.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return {
    data,
    error,
    loading: data === undefined && error === null,
    refreshing: pending,
    reload,
  };
}
