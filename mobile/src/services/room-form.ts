export interface RoomForm {
  name: string;
  description: string;
  price: string;
}
export function roomErrors(form: RoomForm): Partial<Record<keyof RoomForm, string>> {
  const errors: Partial<Record<keyof RoomForm, string>> = {};
  const name = form.name.trim();
  if (name.length < 2 || name.length > 120)
    errors.name = "El nombre debe tener entre 2 y 120 caracteres.";
  if (form.description.length > 2000)
    errors.description = "La descripción admite hasta 2000 caracteres.";
  const price = form.price.trim().replace(",", ".");
  if (
    !/^\d{1,8}(\.\d{1,2})?$/.test(price) ||
    Number(price) <= 0 ||
    Number(price) > 99999999.99
  )
    errors.price = "Ingresa un precio mayor a cero, sin separadores de miles y con máximo dos decimales.";
  return errors;
}
export function roomPayload(form: RoomForm) {
  const error = Object.values(roomErrors(form))[0];
  if (error) throw new Error(error);
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    pricePerHour: Number(form.price.trim().replace(",", ".")),
  };
}
