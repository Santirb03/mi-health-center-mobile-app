import { router } from 'expo-router';
import { useResource } from '../hooks/use-resource';
import { getNotifications } from '../services/notifications';
import { Action } from './booking-ui';
export function NotificationNavigation() {
  const inbox = useResource(getNotifications);
  return <Action variant="secondary" title={`Notificaciones${inbox.data?.unreadCount ? ` (${inbox.data.unreadCount})` : ''}`} onPress={() => router.push('/notifications')} />;
}
