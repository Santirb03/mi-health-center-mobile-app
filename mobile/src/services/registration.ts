export interface RegistrationForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function registrationError(form: RegistrationForm): string | null {
  if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2)
    return "Nombre y apellidos deben tener al menos dos caracteres.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    return "Ingresa un correo electrónico válido.";
  if (form.password.length < 8)
    return "La contraseña debe tener al menos 8 caracteres.";
  if (form.password !== form.confirmPassword)
    return "Las contraseñas no coinciden.";
  return null;
}

export function registrationPayload(form: RegistrationForm) {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    password: form.password,
  };
}
