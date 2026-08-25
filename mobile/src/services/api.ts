import axios, {
    AxiosError,
    InternalAxiosRequestConfig,
} from 'axios';

import {
    getAccessToken,
    getRefreshToken,
    saveTokens,
    clearTokens,
} from './storage';

export const API_URL = 'http://10.25.81.135:3000';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

const refreshApi = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

let isRefreshing = false;

let failedQueue: {
    resolve: (token: string) => void;
    reject: (error: unknown) => void;
}[] = [];

function processQueue(
    error: unknown,
    token: string | null,
) {
    failedQueue.forEach((promise) => {
        if (error) {
            promise.reject(error);
        } else if (token) {
            promise.resolve(token);
        }
    });

    failedQueue = [];
}

api.interceptors.request.use(
    async (config) => {
        const token = await getAccessToken();

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error) => Promise.reject(error),
);

api.interceptors.response.use(
    (response) => response,

    async (error: AxiosError) => {
        const originalRequest =
            error.config as InternalAxiosRequestConfig & {
                _retry?: boolean;
            };

        if (
            error.response?.status !== 401 ||
            originalRequest?._retry ||
            originalRequest?.url?.includes('/auth/refresh')
        ) {
            return Promise.reject(error);
        }

        if (isRefreshing) {
            return new Promise((resolve, reject) => {
                failedQueue.push({
                    resolve: (token) => {
                        originalRequest.headers.Authorization =
                            `Bearer ${token}`;

                        resolve(api(originalRequest));
                    },
                    reject,
                });
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
            const refreshToken = await getRefreshToken();

            if (!refreshToken) {
                await clearTokens();
                return Promise.reject(error);
            }

            const response = await refreshApi.post(
                '/auth/refresh',
                {
                    refreshToken,
                },
            );

            const {
                accessToken,
                refreshToken: newRefreshToken,
            } = response.data;

            await saveTokens(
                accessToken,
                newRefreshToken,
            );

            processQueue(null, accessToken);

            originalRequest.headers.Authorization =
                `Bearer ${accessToken}`;

            return api(originalRequest);
        } catch (refreshError) {
            processQueue(refreshError, null);

            await clearTokens();

            return Promise.reject(refreshError);
        } finally {
            isRefreshing = false;
        }
    },
);