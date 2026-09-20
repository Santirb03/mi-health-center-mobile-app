export interface RegistrationForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function registrationError(form: RegistrationForm): string | null {
  return Object.values(registrationErrors(form))[0] ?? null;
}

export function registrationErrors(
  form: RegistrationForm,
): Partial<Record<keyof RegistrationForm, string>> {
  const errors: Partial<Record<keyof RegistrationForm, string>> = {};
  if (form.firstName.trim().length < 2)
    errors.firstName = "Ingresa un nombre de al menos dos caracteres.";
  if (form.lastName.trim().length < 2)
    errors.lastName = "Ingresa apellidos de al menos dos caracteres.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    errors.email = "Ingresa un correo electrónico válido.";
  if (form.password.length < 8)
    errors.password = "La contraseña debe tener al menos 8 caracteres.";
  if (form.password !== form.confirmPassword)
    errors.confirmPassword = "Las contraseñas no coinciden.";
  return errors;
}

export function registrationPayload(form: RegistrationForm) {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    password: form.password,
  };
}
