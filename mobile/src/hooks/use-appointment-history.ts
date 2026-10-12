import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { session } from "../services/api";
import { createAppointmentPager } from "../services/appointment-schedule";
import { getAppointmentPage } from "../services/appointments";

export function useAppointmentHistory(patientId: string | null, version: number) {
  const pager = useMemo(() => createAppointmentPager(async (patient, cursor, signal) => {
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    const result = await getAppointmentPage(patient, cursor, signal);
    if (session.getVersion() !== version || !session.getTokens()) throw new Error("Session changed");
    return result;
  }), [version]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot, pager.getSnapshot);
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      if (session.getVersion() !== version || !session.getTokens()) pager.dispose();
    });
    return () => { unsubscribe(); pager.cancel(); };
  }, [pager, version]);
  useFocusEffect(useCallback(() => {
    if (pager.getSnapshot().query !== (patientId ?? "")) void pager.setPatient(patientId);
    else void pager.reload();
    const subscription = AppState.addEventListener("change", value => {
      if (value === "active") void pager.reload();
    });
    return () => { pager.cancel(); subscription.remove(); };
  }, [pager, patientId]));
  // Hide the previous patient's items synchronously, before the focus effect runs.
  const visible = state.query === (patientId ?? "") ? state
    : { ...state, items: [], nextCursor: null, loading: true, error: null };
  return { state: visible, reload: pager.reload, more: pager.more, retry: pager.retry };
}
