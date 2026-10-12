import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { session } from "../services/api";
import { createPatientPager } from "../services/patient-pager";
import { getPatientPage } from "../services/patients";

export function usePatientIdentity() {
  return useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
}
export function usePatientList() {
  const version = usePatientIdentity();
  const [input, setInput] = useState({ version, text: "" });
  const text = input.version === version ? input.text : "";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const pager = useMemo(() => createPatientPager(async (q, cursor, signal) => {
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    const page = await getPatientPage(q, cursor, signal);
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    return page;
  }), [version]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot, pager.getSnapshot);
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      if (session.getVersion() !== version || !session.getTokens()) {
        clearTimer();
        pager.dispose();
      }
    });
    return () => { clearTimer(); unsubscribe(); pager.cancel(); };
  }, [pager, version, clearTimer]);
  const reload = useCallback(() => { clearTimer(); return pager.reload(); }, [pager, clearTimer]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void reload();
    const subscription = AppState.addEventListener("change", value => {
      if (value === "active") void reload();
    });
    return () => { focused.current = false; clearTimer(); pager.cancel(); subscription.remove(); };
  }, [pager, reload, clearTimer]));
  const setText = useCallback((value: string) => {
    setInput({ version, text: value });
    const previous = pager.getSnapshot().query;
    void pager.setQuery(value, false);
    if (previous === pager.getSnapshot().query) return;
    clearTimer();
    const kind = pager.getSnapshot().kind;
    if (focused.current && (kind === "all" || kind === "search"))
      timer.current = setTimeout(() => { timer.current = null; void pager.reload(); }, 350);
  }, [pager, version, clearTimer]);
  return { state, text, setText, reload, more: pager.more, retry: pager.retry };
}
