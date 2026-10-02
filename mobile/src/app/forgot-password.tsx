import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthInput } from "../components/auth-input";
import { Action, styles } from "../components/booking-ui";
import { useNow } from "../hooks/use-now";
import { getErrorMessage } from "../services/errors";
import { emailError, requestPasswordReset, resendSeconds, RESET_REQUEST_MESSAGE } from "../services/password-reset";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const now = useNow();
  const seconds = resendSeconds(email, now);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function submit() {
    if (inFlight.current || resendSeconds(email) > 0) return;
    const invalid = emailError(email);
    setFieldError(invalid);
    if (invalid) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await requestPasswordReset(email);
      if (mounted.current) setSent(true);
    } catch (failure) {
      if (mounted.current) setError(getErrorMessage(failure, "No pudimos confirmar la solicitud. Espera un minuto e intenta de nuevo."));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 16 }}>
          <Text style={styles.title}>Olvidé mi contraseña</Text>
          <Text style={styles.muted}>Escribe el correo con el que creaste tu cuenta.</Text>
          <AuthInput accessibilityLabel="Correo electrónico" placeholder="Correo electrónico"
            value={email} editable={!busy} error={fieldError} autoCapitalize="none" autoCorrect={false}
            autoComplete="email" keyboardType="email-address" returnKeyType="send"
            style={{ borderWidth: 1, borderColor: "#aaa", borderRadius: 10, padding: 14, fontSize: 16 }}
            onChangeText={value => { setEmail(value); setFieldError(undefined); setError(undefined); setSent(false); }}
            onSubmitEditing={() => void submit()} />
          {sent && <Text accessibilityLiveRegion="polite" style={styles.muted}>{RESET_REQUEST_MESSAGE}</Text>}
          {error && <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{error}</Text>}
          {seconds > 0 && <Text style={styles.muted}>Puedes volver a solicitar el enlace en {seconds} s.</Text>}
          <Action title={busy ? "Enviando solicitud…" : sent ? "Solicitar otro enlace" : "Solicitar enlace"}
            disabled={busy || seconds > 0} onPress={() => void submit()} />
          <Action title="Volver" variant="quiet" disabled={busy}
            onPress={() => router.canGoBack() ? router.back() : router.replace("/")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
