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
  registrationError,
  registrationPayload,
  type RegistrationForm,
} from "../../services/registration";

export default function RegisterScreen() {
  const [form, setForm] = useState<RegistrationForm>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = (field: keyof RegistrationForm, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));

  async function submit() {
    if (inFlight.current || created) return;
    const validation = registrationError(form);
    if (validation) {
      setError(validation);
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
        setError(
          status === 409
            ? "Ese correo ya tiene una cuenta. Puedes volver e iniciar sesión."
            : status === 400
              ? "Revisa el correo, nombre y contraseña e intenta de nuevo."
              : status === 429
                ? getErrorMessage(
                    failure,
                    "Espera un momento e intenta de nuevo.",
                  )
                : "No pudimos confirmar si se creó la cuenta. Intenta iniciar sesión antes de volver a registrarte.",
        );
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
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, gap: 14 }}
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
              <Text>Nombre</Text>
              <TextInput
                style={inputStyle}
                accessibilityLabel="Nombre"
                value={form.firstName}
                onChangeText={(v) => change("firstName", v)}
                editable={!busy}
                autoCapitalize="words"
                autoComplete="given-name"
              />
              <Text>Apellidos</Text>
              <TextInput
                style={inputStyle}
                accessibilityLabel="Apellidos"
                value={form.lastName}
                onChangeText={(v) => change("lastName", v)}
                editable={!busy}
                autoCapitalize="words"
                autoComplete="family-name"
              />
              <Text>Correo electrónico</Text>
              <TextInput
                style={inputStyle}
                accessibilityLabel="Correo electrónico"
                value={form.email}
                onChangeText={(v) => change("email", v)}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
              />
              <Text>Contraseña (mínimo 8 caracteres)</Text>
              <TextInput
                style={inputStyle}
                accessibilityLabel="Contraseña"
                value={form.password}
                onChangeText={(v) => change("password", v)}
                editable={!busy}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
              />
              <Text>Confirmar contraseña</Text>
              <TextInput
                style={inputStyle}
                accessibilityLabel="Confirmar contraseña"
                value={form.confirmPassword}
                onChangeText={(v) => change("confirmPassword", v)}
                editable={!busy}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void submit()}
              />
              {error && <Text accessibilityRole="alert">{error}</Text>}
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
