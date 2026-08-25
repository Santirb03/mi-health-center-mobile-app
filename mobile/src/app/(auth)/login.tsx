import { useState } from 'react';
import {
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import { login } from '../../services/auth';
import { router } from 'expo-router';
import { saveTokens } from '../../services/storage';

export default function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleLogin() {
        if (!email || !password) {
            Alert.alert('Error', 'Ingresa tu email y contraseña');
            return;
        }

        try {
            setLoading(true);

            const data = await login({
                email,
                password,
            });

            await saveTokens(
                data.accessToken,
                data.refreshToken,
            );

            console.log('LOGIN SUCCESS');

            router.replace('/home');

        } catch (error: any) {
            console.log('LOGIN ERROR:', error);
            console.log('RESPONSE:', error.response?.data);
            console.log('STATUS:', error.response?.status);
            console.log('MESSAGE:', error.message);

            Alert.alert(
                'Error',
                error.response?.data?.message ??
                error.message ??
                'No se pudo iniciar sesión',
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>
                Mi Health Center
            </Text>

            <Text style={styles.subtitle}>
                Iniciar sesión
            </Text>

            <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
            />

            <TextInput
                style={styles.input}
                placeholder="Contraseña"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
            />

            <TouchableOpacity
                style={styles.button}
                onPress={handleLogin}
                disabled={loading}
            >
                <Text style={styles.buttonText}>
                    {loading ? 'Iniciando...' : 'Iniciar sesión'}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#fff',
    },

    title: {
        fontSize: 32,
        fontWeight: 'bold',
        marginBottom: 8,
    },

    subtitle: {
        fontSize: 20,
        marginBottom: 32,
    },

    input: {
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 10,
        padding: 14,
        marginBottom: 16,
        fontSize: 16,
    },

    button: {
        backgroundColor: '#208AEF',
        padding: 16,
        borderRadius: 10,
        alignItems: 'center',
    },

    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
});