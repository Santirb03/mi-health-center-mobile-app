import { useCallback, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { createPaymentHistoryPager } from "../services/payment-history";
import { getPaymentHistory } from "../services/payments";

export function usePaymentHistory() {
  const pager = useMemo(() => createPaymentHistoryPager(getPaymentHistory), []);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot, pager.getSnapshot);
  useFocusEffect(useCallback(() => {
    void pager.reload();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void pager.reload();
    });
    return () => { pager.dispose(); subscription.remove(); };
  }, [pager]));
  return { state, reload: pager.reload, more: pager.more, retry: pager.retry };
}
