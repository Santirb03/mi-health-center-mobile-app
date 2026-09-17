export interface RoomForm {
  name: string;
  description: string;
  price: string;
}
export function roomPayload(form: RoomForm) {
  const name = form.name.trim();
  if (name.length < 2 || name.length > 120)
    throw new Error("El nombre debe tener entre 2 y 120 caracteres.");
  if (form.description.length > 2000)
    throw new Error("La descripción admite hasta 2000 caracteres.");
  const price = form.price.trim().replace(",", ".");
  if (
    !/^\d{1,8}(\.\d{1,2})?$/.test(price) ||
    Number(price) <= 0 ||
    Number(price) > 99999999.99
  )
    throw new Error(
      "Ingresa un precio mayor a cero, sin separadores de miles y con máximo dos decimales.",
    );
  return {
    name,
    description: form.description.trim(),
    pricePerHour: Number(price),
  };
}
