import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Action, Page, LoadState, styles } from '../components/booking-ui';
import { useResource } from '../hooks/use-resource';
import { getNotifications, markRead, markAllRead } from '../services/notifications';
import { remindersEnabled, setRemindersEnabled, syncReminders, testReminder } from '../services/reminders';

export default function NotificationsScreen() {
  const inbox = useResource(getNotifications);
  const reminders = useResource(remindersEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); await inbox.reload(); await reminders.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos guardar el cambio.'); }
    finally { setBusy(false); }
  }
  return <Page>
    <Text style={styles.title}>Notificaciones</Text>
    {Platform.OS !== 'web' && <View style={styles.card}>
      <Text>Un recordatorio por reserva, una hora antes. Sin sonido ni vibración.</Text>
      <Text style={styles.muted}>Se actualizan al abrir la app. Si cambias una reserva desde otro dispositivo, abre esta app para sincronizarla.</Text>
      <LoadState {...reminders} />
      <Action disabled={busy || reminders.loading || !!reminders.error} title={reminders.data ? 'Desactivar recordatorios' : 'Activar recordatorios'} onPress={() => void act(() => setRemindersEnabled(!reminders.data))} />
      {reminders.data && <Action disabled={busy} variant="secondary" title="Sincronizar recordatorios" onPress={() => void act(syncReminders)} />}
      {__DEV__ && reminders.data && <Action disabled={busy} variant="secondary" title="Probar aviso silencioso (15 segundos)" onPress={() => void act(async () => {
        await testReminder();
        Alert.alert('Prueba programada', 'Ve al inicio del teléfono sin cerrar sesión. En 15 segundos revisa el centro de notificaciones: debe aparecer sin sonido ni vibración.');
      })} />}
    </View>}
    <LoadState {...inbox} />
    {!!error && <Text accessibilityRole="alert">{error}</Text>}
    {!!inbox.data?.unreadCount && <Action disabled={busy} title="Marcar todas como leídas" onPress={() => void act(markAllRead)} />}
    {inbox.data?.items.length === 0 && <Text>No tienes notificaciones todavía.</Text>}
    {inbox.data?.items.map(item => <View key={item.id} style={styles.card}>
      <Text style={styles.subtitle}>{!item.readAt ? '• ' : ''}{item.title}</Text>
      <Text>{item.body}</Text><Text style={styles.muted}>{new Date(item.createdAt).toLocaleString('es-MX')}</Text>
      <Action variant="secondary" title="Ver reserva" onPress={() => router.push({ pathname: '/reservations/[id]', params: { id: item.reservationId } })} />
      {!item.readAt && <Action disabled={busy} variant="quiet" title="Marcar como leída" onPress={() => void act(() => markRead(item.id))} />}
    </View>)}
    {!!inbox.data?.items.length && <Text style={styles.muted}>Se muestran los últimos 100 avisos.</Text>}
  </Page>;
}
