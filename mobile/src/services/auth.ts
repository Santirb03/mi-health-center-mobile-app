import { api } from './api';
import { saveTokens } from './storage';

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

    const { accessToken, refreshToken } = response.data;

    await saveTokens(accessToken, refreshToken);

    return response.data;
}