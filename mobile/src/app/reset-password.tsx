import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthInput } from "../components/auth-input";
import { Action, styles } from "../components/booking-ui";
import { useSession } from "../providers/session-provider";
import { INVALID_RESET_MESSAGE, resetErrors, resetFailure, resetToken, submitPasswordReset } from "../services/password-reset";

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  // Remount the form for another link so stale results cannot affect the new token.
  const parsed = resetToken(token);
  return <ResetForm key={parsed ?? "invalid"} token={parsed} />;
}

function ResetForm({ token }: { token: string | null }) {
  const { signOut } = useSession();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof resetErrors>>({});
  const [error, setError] = useState<string>();
  const [invalid, setInvalid] = useState(!token);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function submit() {
    if (inFlight.current || done || invalid || !token) return;
    const validation = resetErrors(password, confirmation);
    setErrors(validation);
    setError(undefined);
    if (Object.keys(validation).length) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await submitPasswordReset(token, password);
      if (mounted.current) { setPassword(""); setConfirmation(""); setDone(true); }
    } catch (failure) {
      if (mounted.current) {
        const result = resetFailure(failure);
        setInvalid(result.invalidToken);
        setError(result.message);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function goToLogin() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await signOut();
      if (mounted.current) router.replace("/(auth)/login");
    } catch {
      if (mounted.current) setError("No pudimos cerrar la sesión anterior. Intenta volver al inicio de sesión otra vez.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const inputStyle = { borderWidth: 1, borderColor: "#aaa", borderRadius: 10, padding: 14, fontSize: 16 };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 16 }}>
          <Text style={styles.title}>{done ? "Contraseña actualizada" : "Restablecer contraseña"}</Text>
          {done ? <Text style={styles.muted}>Ya puedes iniciar sesión con tu nueva contraseña.</Text> : invalid ? (
            <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{INVALID_RESET_MESSAGE}</Text>
          ) : (
            <>
              <Text style={styles.muted}>Elige una contraseña de al menos 8 caracteres.</Text>
              <AuthInput style={inputStyle} accessibilityLabel="Nueva contraseña" placeholder="Nueva contraseña"
                value={password} password editable={!busy} error={errors.password} autoComplete="new-password"
                autoCapitalize="none" autoCorrect={false} onChangeText={value => { setPassword(value); setErrors({}); setError(undefined); }} />
              <AuthInput style={inputStyle} accessibilityLabel="Confirmar contraseña" placeholder="Confirmar contraseña"
                value={confirmation} password editable={!busy} error={errors.confirmation} autoComplete="new-password"
                autoCapitalize="none" autoCorrect={false} returnKeyType="done"
                onChangeText={value => { setConfirmation(value); setErrors({}); setError(undefined); }}
                onSubmitEditing={() => void submit()} />
              <Action title={busy ? "Guardando…" : "Guardar nueva contraseña"} disabled={busy} onPress={() => void submit()} />
            </>
          )}
          {error && error !== INVALID_RESET_MESSAGE && <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{error}</Text>}
          {invalid && <Action title="Solicitar un nuevo enlace" onPress={() => router.replace("/forgot-password")} />}
          <Action title="Volver a iniciar sesión" variant="quiet" disabled={busy} onPress={() => void goToLogin()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
