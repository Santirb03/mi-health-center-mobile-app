import type { Reservation } from './reservations';

export function reminderPlan(items: Reservation[], now = Date.now()) {
  return items.filter(r => r.status === 'CONFIRMED' && Date.parse(r.startTime) - 3600000 > now)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .slice(0, 50)
    .map(r => ({ id: r.id, at: Date.parse(r.startTime) - 3600000 }));
}
