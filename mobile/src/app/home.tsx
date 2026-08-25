import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { api } from '../services/api';

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

    useEffect(() => {
        async function loadRooms() {
            try {
                const response = await api.get<Room[]>('/rooms');

                setRooms(response.data);
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
            <Text style={styles.title}>Mi Health Center</Text>

            <Text style={styles.subtitle}>
                Consultorios disponibles
            </Text>

            <FlatList
                data={rooms}
                keyExtractor={(room) => room.id}
                contentContainerStyle={styles.list}
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

    title: {
        fontSize: 30,
        fontWeight: 'bold',
        paddingHorizontal: 24,
    },

    subtitle: {
        fontSize: 20,
        marginTop: 8,
        marginBottom: 20,
        paddingHorizontal: 24,
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