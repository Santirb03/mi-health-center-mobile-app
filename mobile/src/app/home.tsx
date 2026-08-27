import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { router } from 'expo-router';

import { api } from '../services/api';
import { clearTokens } from '../services/storage';

interface Room {
    id: string;
    name: string;
    description: string;
    pricePerHour: string;
    active: boolean;
}

export default function HomeScreen() {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);

    async function handleLogout() {
        try {
            await api.post('/auth/logout');
        } catch (error) {
            console.log('LOGOUT API ERROR:', error);
        } finally {
            await clearTokens();
            router.replace('/(auth)/login');
        }
    }

    function confirmLogout() {
        Alert.alert(
            'Cerrar sesión',
            '¿Estás seguro de que quieres cerrar sesión?',
            [
                {
                    text: 'Cancelar',
                    style: 'cancel',
                },
                {
                    text: 'Cerrar sesión',
                    style: 'destructive',
                    onPress: handleLogout,
                },
            ],
        );
    }

    useEffect(() => {
        async function loadRooms() {
            try {
                const response = await api.get<Room[]>('/rooms');

                setRooms(response.data);

                console.log('ROOMS SUCCESS:', response.data);
            } catch (error: any) {
                console.log(
                    'ROOMS ERROR:',
                    error.response?.data ?? error.message,
                );
            } finally {
                setLoading(false);
            }
        }

        loadRooms();
    }, []);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" />

                <Text style={styles.loadingText}>
                    Cargando consultorios...
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>
                        Mi Health Center
                    </Text>

                    <Text style={styles.subtitle}>
                        Consultorios disponibles
                    </Text>
                </View>

                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={confirmLogout}
                >
                    <Text style={styles.logoutText}>
                        Salir
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={rooms}
                keyExtractor={(room) => room.id}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <Text style={styles.roomName}>
                            {item.name}
                        </Text>

                        <Text style={styles.description}>
                            {item.description}
                        </Text>

                        <Text style={styles.price}>
                            ${item.pricePerHour} / hora
                        </Text>

                        <Text
                            style={
                                item.active
                                    ? styles.available
                                    : styles.unavailable
                            }
                        >
                            {item.active
                                ? 'Disponible'
                                : 'No disponible'}
                        </Text>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f7f8fa',
        paddingTop: 70,
    },

    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },

    loadingText: {
        marginTop: 12,
        fontSize: 16,
    },

    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginBottom: 20,
    },

    title: {
        fontSize: 30,
        fontWeight: 'bold',
    },

    subtitle: {
        fontSize: 18,
        marginTop: 6,
        color: '#666',
    },

    logoutButton: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },

    logoutText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#d11a2a',
    },

    list: {
        paddingHorizontal: 20,
        paddingBottom: 30,
    },

    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
    },

    roomName: {
        fontSize: 21,
        fontWeight: 'bold',
    },

    description: {
        fontSize: 15,
        color: '#666',
        marginTop: 8,
    },

    price: {
        fontSize: 18,
        fontWeight: '600',
        marginTop: 16,
    },

    available: {
        color: 'green',
        fontWeight: '600',
        marginTop: 8,
    },

    unavailable: {
        color: 'red',
        fontWeight: '600',
        marginTop: 8,
    },
});