import { useRef, useState } from "react";
import { router } from 'expo-router';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from "react-native";

import axios from "axios";
import { useSession } from "../../providers/session-provider";
import { getErrorMessage } from "../../services/errors";

export default function LoginScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  async function handleLogin() {
    if (submitting.current) return;
    if (!email.trim() || !password) {
      Alert.alert("Error", "Ingresa tu correo electrónico y contraseña");
      return;
    }

    try {
      submitting.current = true;
      setLoading(true);

      await signIn({
        email: email.trim(),
        password,
      });
    } catch (error) {
      Alert.alert(
        "Error",
        axios.isAxiosError(error) && error.response?.status === 401
          ? "El correo electrónico o la contraseña son incorrectos."
          : getErrorMessage(
              error,
              "No se pudo iniciar sesión. Revisa tus datos e intenta de nuevo.",
            ),
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Mi Health Center</Text>

      <Text style={styles.subtitle}>Iniciar sesión</Text>

      <TextInput
        style={styles.input}
        placeholder="Correo electrónico"
        accessibilityLabel="Correo electrónico"
        editable={!loading}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        accessibilityLabel="Contraseña"
        editable={!loading}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={() => { void handleLogin(); }}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleLogin}
        disabled={loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading, busy: loading }}
      >
        <Text style={styles.buttonText}>
          {loading ? "Iniciando..." : "Iniciar sesión"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        style={{ padding: 16, alignItems: 'center' }}
        disabled={loading}
        onPress={() => router.push('/(auth)/register')}
      >
        <Text style={{ color: '#1765ae', fontSize: 16 }}>Crear cuenta</Text>
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },

  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 20,
    marginBottom: 32,
  },

  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    fontSize: 16,
  },

  button: {
    backgroundColor: "#208AEF",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
  },

  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
