// Web has no native notification scheduler.
export async function syncReminders() {}
export async function clearReminders() {}
export async function testReminder() { throw new Error('Disponible en la app de Android o iPhone.'); }
export async function remindersEnabled() { return false; }
export async function setRemindersEnabled(_enabled: boolean) { throw new Error('Disponible en la app de Android o iPhone.'); }
