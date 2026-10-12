import { Prisma } from '@prisma/client';

export const appointmentSelection = {
  id: true, status: true, startTime: true, endTime: true, createdAt: true, updatedAt: true,
  patient: { select: { id: true, firstName: true, lastName: true } },
  reservation: { select: { id: true, status: true, startTime: true, endTime: true,
    room: { select: { id: true, name: true } } } },
} satisfies Prisma.AppointmentSelect;
export type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelection }>;
export function appointmentView(row: AppointmentRow) {
  return {
    id: row.id, status: row.status, startTime: row.startTime.toISOString(), endTime: row.endTime.toISOString(),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), patient: row.patient,
    reservation: row.reservation ? { ...row.reservation,
      startTime: row.reservation.startTime.toISOString(), endTime: row.reservation.endTime.toISOString() } : null,
    needsRoomReview: row.status === 'SCHEDULED' && row.reservation?.status !== 'CONFIRMED',
  };
}
export type AppointmentView = ReturnType<typeof appointmentView>;
