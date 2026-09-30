import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getReservationPage } from './reservations';
import { collectConfirmed } from './upcoming-reservations';
import { getCurrentUser } from './admin-agenda';
import { session } from './api';
import { reminderPlan } from './reminder-plan';

const channelId = 'reservation-reminders-silent-v1';
let queue = Promise.resolve();
const serial = (work: () => Promise<void>) => {
  const task = queue.then(work);
  queue = task.catch(() => {});
  return task;
};
Notifications.setNotificationHandler({ handleNotification: async () => ({
  shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: true,
}) });

async function clear() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) if (item.identifier.startsWith('mhc-reminder:')) {
    await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
  await Notifications.dismissAllNotificationsAsync();
}
export function clearReminders() { return serial(clear); }
export function testReminder() {
  if (!__DEV__) return Promise.reject(new Error('Prueba disponible solo en desarrollo.'));
  const version = session.getVersion();
  return serial(async () => {
    if (!session.getTokens() || !await remindersEnabled()) throw new Error('Activa primero los recordatorios.');
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) throw new Error('Permite las notificaciones en los ajustes del teléfono.');
    if (version !== session.getVersion() || !session.getTokens()) throw new Error('La sesión cambió.');
    const identifier = 'mhc-reminder:test';
    await Notifications.cancelScheduledNotificationAsync(identifier);
    await Notifications.scheduleNotificationAsync({ identifier,
      content: { title: 'Prueba de recordatorio', body: 'Este aviso debe aparecer sin sonido ni vibración.', sound: false },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 15000), channelId },
    });
    if (version !== session.getVersion()) await clear();
  });
}
export async function remindersEnabled() {
  const user = await getCurrentUser();
  return await SecureStore.getItemAsync(`reminders-${user.id}`) === 'on';
}
export async function setRemindersEnabled(enabled: boolean) {
  const version = session.getVersion();
  const user = await getCurrentUser();
  if (enabled) {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(channelId, {
      name: 'Recordatorios de reservas', importance: Notifications.AndroidImportance.LOW,
      sound: null, enableVibrate: false, vibrationPattern: [0], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    const permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: false, allowBadge: false } });
    if (!permission.granted) throw new Error('Activa las notificaciones en los ajustes del teléfono para recibir recordatorios.');
  }
  if (version !== session.getVersion() || !session.getTokens()) throw new Error('La sesión cambió. Intenta de nuevo.');
  await SecureStore.setItemAsync(`reminders-${user.id}`, enabled ? 'on' : 'off');
  if (enabled) await syncReminders(); else await clearReminders();
}
export function syncReminders() {
  const version = session.getVersion();
  return serial(async () => {
    if (!session.getTokens()) return clear();
    const user = await getCurrentUser();
    if (user.role !== 'DOCTOR' || await SecureStore.getItemAsync(`reminders-${user.id}`) !== 'on') return clear();
    const controller = new AbortController();
    const items = await collectConfirmed((cursor) => getReservationPage('confirmed', cursor, controller.signal));
    if (version !== session.getVersion() || !session.getTokens()) return clear();
    const desired = reminderPlan(items);
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const keys = new Set(desired.map(r => `mhc-reminder:${user.id}:${r.id}:${r.at}`));
    if (__DEV__) keys.add('mhc-reminder:test');
    for (const item of existing) if (item.identifier.startsWith('mhc-reminder:') && !keys.has(item.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
    for (const item of desired) {
      if (version !== session.getVersion() || !session.getTokens()) return clear();
      const identifier = `mhc-reminder:${user.id}:${item.id}:${item.at}`;
      if (existing.some(n => n.identifier === identifier)) continue;
      await Notifications.scheduleNotificationAsync({ identifier,
        content: { title: 'Próxima reserva', body: 'Tu reserva comienza en una hora. Consulta los detalles en la app.', sound: false, data: { reservationId: item.id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(item.at), channelId },
      });
    }
    if (version !== session.getVersion()) await clear();
  });
}
