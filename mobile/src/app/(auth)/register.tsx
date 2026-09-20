import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import axios from "axios";
import { Action, styles } from "../../components/booking-ui";
import { register } from "../../services/auth";
import { getErrorMessage } from "../../services/errors";
import {
  registrationErrors,
  registrationPayload,
  type RegistrationForm,
} from "../../services/registration";

import { AuthInput } from "../../components/auth-input";

export default function RegisterScreen() {
  const [form, setForm] = useState<RegistrationForm>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [emailConflict, setEmailConflict] = useState<string | undefined>();
  const fieldErrors = submitted ? registrationErrors(form) : {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const scroll = useRef<ScrollView>(null);
  const lastNameInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = (field: keyof RegistrationForm, value: string) => {
    if (field === "email") setEmailConflict(undefined);
    setError(null);
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  async function submit() {
    if (inFlight.current || created) return;
    setSubmitted(true);
    const validation = registrationErrors(form);
    if (Object.keys(validation).length) {
      setError(null);
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await register(registrationPayload(form));
      if (mounted.current) {
        setForm((previous) => ({
          ...previous,
          password: "",
          confirmPassword: "",
        }));
        setCreated(true);
      }
    } catch (failure) {
      if (mounted.current) {
        const status = axios.isAxiosError(failure)
          ? failure.response?.status
          : undefined;
        if (status === 409)
          setEmailConflict("Ese correo ya tiene una cuenta. Inicia sesión.");
        setError(
          status === 409
            ? null
            : status === 400
              ? "Revisa el correo, nombre y contraseña e intenta de nuevo."
              : status === 429
                ? getErrorMessage(
                    failure,
                    "Espera un momento e intenta de nuevo.",
                  )
                : "No pudimos confirmar si se creó la cuenta. Intenta iniciar sesión antes de volver a registrarte.",
        );
        scroll.current?.scrollTo({ y: 0, animated: true });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const inputStyle = {
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 14 }}
        >
          <Text style={styles.title}>
            {created ? "Cuenta creada" : "Crear cuenta"}
          </Text>
          {created ? (
            <Text>Ya puedes iniciar sesión con tu correo y contraseña.</Text>
          ) : (
            <>
              <Text style={styles.muted}>
                Completa tus datos para registrarte en Mi Health Center.
              </Text>
              {error && (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={{ color: "#b42318" }}
                >
                  {error}
                </Text>
              )}
              <Text>Nombre</Text>
              <AuthInput
                style={inputStyle}
                accessibilityLabel="Nombre"
                error={fieldErrors.firstName}
                value={form.firstName}
                onChangeText={(v) => change("firstName", v)}
                editable={!busy}
                autoCapitalize="words"
                autoComplete="given-name"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => lastNameInput.current?.focus()}
              />
              <Text>Apellidos</Text>
              <AuthInput
                style={inputStyle}
                accessibilityLabel="Apellidos"
                ref={lastNameInput}
                error={fieldErrors.lastName}
                value={form.lastName}
                onChangeText={(v) => change("lastName", v)}
                editable={!busy}
                autoCapitalize="words"
                autoComplete="family-name"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailInput.current?.focus()}
              />
              <Text>Correo electrónico</Text>
              <AuthInput
                style={inputStyle}
                accessibilityLabel="Correo electrónico"
                ref={emailInput}
                error={emailConflict ?? fieldErrors.email}
                value={form.email}
                onChangeText={(v) => change("email", v)}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordInput.current?.focus()}
              />
              <Text>Contraseña (mínimo 8 caracteres)</Text>
              <AuthInput
                style={inputStyle}
                accessibilityLabel="Contraseña"
                ref={passwordInput}
                error={fieldErrors.password}
                value={form.password}
                onChangeText={(v) => change("password", v)}
                editable={!busy}
                password
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => confirmInput.current?.focus()}
              />
              <Text>Confirmar contraseña</Text>
              <AuthInput
                style={inputStyle}
                accessibilityLabel="Confirmar contraseña"
                ref={confirmInput}
                error={fieldErrors.confirmPassword}
                value={form.confirmPassword}
                onChangeText={(v) => change("confirmPassword", v)}
                editable={!busy}
                password
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void submit()}
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
              />
              <Action
                title={busy ? "Creando cuenta…" : "Crear cuenta"}
                disabled={busy}
                onPress={() => void submit()}
              />
            </>
          )}
          <View>
            <Action
              title="Volver a iniciar sesión"
              disabled={busy}
              onPress={() => router.replace("/(auth)/login")}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
