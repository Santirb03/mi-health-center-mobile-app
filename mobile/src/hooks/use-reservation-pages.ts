import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createReservationPager } from '../services/reservation-pager';
import { getReservationPage } from '../services/reservations';

export function useReservationPages() {
  const pager = useMemo(() => createReservationPager(getReservationPage), []);
  const pages = useSyncExternalStore(pager.subscribe, pager.getSnapshot, pager.getSnapshot);
  useFocusEffect(useCallback(() => {
    void pager.reload();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pager.reload();
    });
    return () => { pager.dispose(); subscription.remove(); };
  }, [pager]));
  return { pages, reload: pager.reload, more: pager.more };
}
