import { ApiError } from "@jk/contracts-rest";
import { useEffect, useState } from "react";

export interface AsyncState<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
}

/** Run an async loader on mount / when `deps` change; surface a friendly error. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ loading: true, data: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => {
        if (active) setState({ loading: false, data, error: null });
      })
      .catch((e: unknown) => {
        if (!active) return;
        const message = e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : "Unknown error";
        setState({ loading: false, data: null, error: message });
      });
    return () => {
      active = false;
    };
  }, [...deps, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
