import { api } from './api';

export interface LoginResponse {
    accessToken: string;
    refreshToken: string;
}

export interface LoginData {
    email: string;
    password: string;
}

export async function login(
    data: LoginData,
): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>(
        '/auth/login',
        data,
    );

    return response.data;
}