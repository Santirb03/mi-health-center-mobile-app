import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { Session, SessionExpiredError, Tokens } from "./session";

type SessionRequest = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _sessionVersion?: number;
};

export function createApiClient(baseURL: string, session: Session) {
  const options = {
    baseURL,
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  };
  const api = axios.create(options);
  const publicApi = axios.create(options);
  let refresh: { version: number; promise: Promise<string> } | null = null;

  function refreshAccessToken(version: number): Promise<string> {
    if (refresh?.version === version) return refresh.promise;
    const pending = (async () => {
      try {
        const token = session.getTokens()?.refreshToken;
        if (!token) throw new SessionExpiredError();
        const response = await publicApi.post<Tokens>("/auth/refresh", {
          refreshToken: token,
        });
        await session.save(response.data, version);
        return response.data.accessToken;
      } catch (error) {
        const rejected =
          error instanceof SessionExpiredError ||
          (axios.isAxiosError(error) &&
            [401, 403].includes(error.response?.status ?? 0));
        if (rejected && session.getVersion() === version) await session.clear();
        // Connectivity failures do not prove that credentials are invalid.
        throw error;
      }
    })();
    refresh = { version, promise: pending };
    void pending
      .finally(() => {
        if (refresh?.promise === pending) refresh = null;
      })
      .catch(() => {});
    return pending;
  }

  api.interceptors.request.use((config: SessionRequest) => {
    if (
      config._sessionVersion !== undefined &&
      config._sessionVersion !== session.getVersion()
    ) {
      throw new SessionExpiredError();
    }
    config._sessionVersion = session.getVersion();
    const token = session.getTokens()?.accessToken;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    else config.headers.delete("Authorization");
    return config;
  });

  api.interceptors.response.use(
    (response) => {
      const config = response.config as SessionRequest;
      if (config._sessionVersion !== session.getVersion())
        throw new SessionExpiredError();
      return response;
    },
    async (error: AxiosError) => {
      const request = error.config as SessionRequest | undefined;
      if (!request || error.response?.status !== 401) throw error;
      const version = request._sessionVersion!;
      if (version !== session.getVersion()) throw new SessionExpiredError();
      if (request._retry) {
        if (
          request.headers.Authorization ===
          `Bearer ${session.getTokens()?.accessToken}`
        ) {
          await session.clear();
        }
        throw new SessionExpiredError();
      }
      request._retry = true;
      const current = session.getTokens()?.accessToken;
      // A different request may have rotated tokens before this 401 arrived.
      if (!current || request.headers.Authorization === `Bearer ${current}`) {
        await refreshAccessToken(version);
      }
      if (version !== session.getVersion()) throw new SessionExpiredError();
      return api(request);
    },
  );

  return { api, publicApi };
}
