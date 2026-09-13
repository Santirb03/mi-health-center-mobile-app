import axios from "axios";
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { api, session } from "../services/api";
import { login, LoginData, logout } from "../services/auth";
import { getErrorMessage } from "../services/errors";
import { SessionExpiredError } from "../services/session";

interface SessionContextValue {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  retry(): Promise<void>;
  signIn(data: LoginData): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const tokens = useSyncExternalStore(
    session.subscribe,
    session.getTokens,
    () => null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const restoring = useRef(false);

  const retry = useCallback(async () => {
    if (restoring.current) return;
    restoring.current = true;
    setLoading(true);
    setError(null);
    try {
      await session.restore();
      if (session.getTokens()) await api.get("/protected");
    } catch (failure) {
      const expired =
        failure instanceof SessionExpiredError ||
        (axios.isAxiosError(failure) &&
          [401, 403].includes(failure.response?.status ?? 0));
      if (!expired)
        setError(
          getErrorMessage(
            failure,
            "No pudimos recuperar tu sesión. Intenta de nuevo.",
          ),
        );
    } finally {
      restoring.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void retry();
  }, [retry]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && session.getTokens() && !restoring.current) {
        // A rejected token invalidates the session in the interceptor. Connectivity
        // failures leave it intact and are surfaced by the screen's next request.
        void api.get("/protected").catch(() => {});
      }
    });
    return () => subscription.remove();
  }, []);

  async function signOut() {
    setError(null);
    setLoading(true);
    try {
      await logout();
    } finally {
      setLoading(false);
    }
  }

  return (
    <SessionContext.Provider
      value={{
        authenticated: !!tokens,
        loading,
        error,
        retry,
        signIn: login,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}
