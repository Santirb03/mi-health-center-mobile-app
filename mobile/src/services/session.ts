export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  saveTokens(accessToken: string, refreshToken: string): Promise<void>;
  clearTokens(): Promise<void>;
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Tu sesión terminó. Inicia sesión de nuevo.");
  }
}

// Independent of React and SecureStore so races can be tested without a device.
export function createSession(storage: TokenStorage) {
  let tokens: Tokens | null = null;
  let version = 0;
  let writes = Promise.resolve();
  let restoration: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function enqueue(work: () => Promise<void>) {
    const result = writes.then(work);
    writes = result.catch(() => {});
    return result;
  }

  async function clear() {
    version++;
    tokens = null;
    notify();
    // Runs after any in-flight save, so a late refresh cannot restore disk state.
    await enqueue(() => storage.clearTokens());
  }

  async function save(next: Tokens, expectedVersion: number) {
    if (!next.accessToken || !next.refreshToken)
      throw new Error("Invalid token response");
    await enqueue(async () => {
      if (version !== expectedVersion) throw new SessionExpiredError();
      try {
        await storage.saveTokens(next.accessToken, next.refreshToken);
      } catch (error) {
        if (version === expectedVersion) {
          version++;
          tokens = null;
          notify();
        }
        await storage.clearTokens();
        throw error;
      }
      if (version !== expectedVersion) throw new SessionExpiredError();
      tokens = next;
      notify();
    });
  }

  return {
    getTokens: () => tokens,
    getVersion: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore() {
      if (!restoration) {
        const expectedVersion = version;
        restoration = (async () => {
          const [accessToken, refreshToken] = await Promise.all([
            storage.getAccessToken(),
            storage.getRefreshToken(),
          ]);
          if (version !== expectedVersion) return;
          if (accessToken && refreshToken) {
            tokens = { accessToken, refreshToken };
            notify();
          } else if (accessToken || refreshToken) {
            await clear();
          }
        })().catch((error) => {
          restoration = null;
          throw error;
        });
      }
      return restoration;
    },
    async beginLogin() {
      const expectedVersion = version + 1;
      await clear();
      if (expectedVersion !== version) throw new SessionExpiredError();
      return expectedVersion;
    },
    save,
    clear,
  };
}

export type Session = ReturnType<typeof createSession>;
