import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { getErrorMessage } from "../services/errors";

// Read requests refresh on focus/foreground; cancelled results never update UI.
export function useResource<T>(read: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const result = await read(controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          getErrorMessage(
            failure,
            "No pudimos cargar la información. Intenta de nuevo.",
          ),
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [read]);
  useFocusEffect(
    useCallback(() => {
      void reload();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void reload();
      });
      return () => {
        pending.current?.abort();
        subscription.remove();
      };
    }, [reload]),
  );
  return { data, loading, error, reload };
}
