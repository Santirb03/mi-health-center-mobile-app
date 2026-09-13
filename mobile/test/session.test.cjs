const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const axios = require("axios");

// Transpile only our pure service modules in memory; no Metro, device, or files emitted.
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};
const {
  createSession,
  SessionExpiredError,
} = require("../src/services/session.ts");
const { createApiClient } = require("../src/services/api-client.ts");
const { getErrorMessage } = require("../src/services/errors.ts");

const original = { accessToken: "access-old", refreshToken: "refresh-old" };
const rotated = { accessToken: "access-new", refreshToken: "refresh-new" };
const bounded = { timeout: 2000 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memoryStorage(initial = original) {
  let value = initial;
  let clears = 0;
  return {
    getAccessToken: async () => value?.accessToken ?? null,
    getRefreshToken: async () => value?.refreshToken ?? null,
    saveTokens: async (accessToken, refreshToken) => {
      value = { accessToken, refreshToken };
    },
    clearTokens: async () => {
      value = null;
      clears++;
    },
    value: () => value,
    clears: () => clears,
  };
}

async function setup(initial = original) {
  const storage = memoryStorage(initial);
  const session = createSession(storage);
  await session.restore();
  const clients = createApiClient("https://api.integration.invalid", session);
  // Every request must provide an in-memory adapter; never access the network.
  const unexpected = () => {
    throw new Error("Unexpected request");
  };
  clients.api.defaults.adapter = unexpected;
  clients.publicApi.defaults.adapter = unexpected;
  return { storage, session, ...clients };
}

function response(config, data = {}, status = 200) {
  return { config, data, status, statusText: String(status), headers: {} };
}

function reject(config, status = 401) {
  throw new axios.AxiosError(
    "Request rejected",
    "ERR_BAD_RESPONSE",
    config,
    undefined,
    response(config, {}, status),
  );
}

test(
  "all concurrent 401 requests settle when no refresh token exists",
  bounded,
  async () => {
    const { api, publicApi, session } = await setup(null);
    api.defaults.adapter = async (config) => reject(config);
    let refreshCalls = 0;
    publicApi.defaults.adapter = async () => {
      refreshCalls++;
    };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => api.get("/protected")),
    );
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.equal(refreshCalls, 0);
    assert.equal(session.getTokens(), null);
  },
);

test(
  "five simultaneous 401s share one refresh and retry with the rotated token",
  bounded,
  async () => {
    const { api, publicApi, storage } = await setup();
    const waiting = deferred();
    let initialCalls = 0;
    let refreshCalls = 0;
    api.defaults.adapter = async (config) => {
      if (config.headers.Authorization === "Bearer access-old") {
        if (++initialCalls === 5) waiting.resolve();
        return reject(config);
      }
      assert.equal(config.headers.Authorization, "Bearer access-new");
      return response(config, { ok: true });
    };
    publicApi.defaults.adapter = async (config) => {
      assert.equal(config.url, "/auth/refresh");
      assert.equal(config.headers.Authorization, undefined);
      refreshCalls++;
      await waiting.promise;
      return response(config, rotated);
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.get("/protected")),
    );
    assert.equal(results.length, 5);
    assert.equal(refreshCalls, 1);
    assert.deepEqual(storage.value(), rotated);
  },
);

test(
  "refresh rejection rejects every waiter and clears the session",
  bounded,
  async () => {
    const { api, publicApi, session, storage } = await setup();
    api.defaults.adapter = async (config) => reject(config);
    publicApi.defaults.adapter = async (config) => reject(config);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => api.get("/protected")),
    );
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.equal(session.getTokens(), null);
    assert.equal(storage.value(), null);
    assert.equal(storage.clears(), 1);
  },
);

test(
  "network failure during refresh preserves credentials and permits a later retry",
  bounded,
  async () => {
    const { api, publicApi, session } = await setup();
    api.defaults.adapter = async (config) =>
      config.headers.Authorization === "Bearer access-old"
        ? reject(config)
        : response(config, "success");
    publicApi.defaults.adapter = async (config) => {
      throw new axios.AxiosError("Network Error", "ERR_NETWORK", config);
    };
    await assert.rejects(api.get("/protected"));
    assert.deepEqual(session.getTokens(), original);
    publicApi.defaults.adapter = async (config) => response(config, rotated);
    assert.equal((await api.get("/protected")).data, "success");
  },
);

test(
  "a delayed old-token 401 reuses an already refreshed token",
  bounded,
  async () => {
    const { api, publicApi } = await setup();
    const slowStarted = deferred();
    const release = deferred();
    let refreshCalls = 0;
    api.defaults.adapter = async (config) => {
      if (config.headers.Authorization === "Bearer access-old") {
        if (config.url === "/slow") {
          slowStarted.resolve();
          await release.promise;
        }
        return reject(config);
      }
      return response(config);
    };
    publicApi.defaults.adapter = async (config) => {
      refreshCalls++;
      return response(config, rotated);
    };
    const slow = api.get("/slow");
    await slowStarted.promise;
    await api.get("/fast");
    release.resolve();
    await slow;
    assert.equal(refreshCalls, 1);
  },
);

test(
  "a retried request that still returns 401 stops and invalidates the session",
  bounded,
  async () => {
    const { api, publicApi, session } = await setup();
    let requests = 0;
    api.defaults.adapter = async (config) => {
      requests++;
      return reject(config);
    };
    publicApi.defaults.adapter = async (config) => response(config, rotated);
    await assert.rejects(api.get("/protected"), SessionExpiredError);
    assert.equal(requests, 2);
    assert.equal(session.getTokens(), null);
  },
);

test(
  "a refresh arriving after logout cannot restore memory or SecureStore",
  bounded,
  async () => {
    const { api, publicApi, session, storage } = await setup();
    const started = deferred();
    const release = deferred();
    api.defaults.adapter = async (config) => reject(config);
    publicApi.defaults.adapter = async (config) => {
      started.resolve();
      await release.promise;
      return response(config, rotated);
    };
    const request = assert.rejects(api.get("/protected"), SessionExpiredError);
    await started.promise;
    await session.clear();
    release.resolve();
    await request;
    assert.equal(session.getTokens(), null);
    assert.equal(storage.value(), null);
  },
);

test(
  "logout waits for an in-flight storage write and clears it afterward",
  bounded,
  async () => {
    const storage = memoryStorage();
    const started = deferred();
    const release = deferred();
    const save = storage.saveTokens;
    storage.saveTokens = async (...args) => {
      started.resolve();
      await release.promise;
      await save(...args);
    };
    const session = createSession(storage);
    await session.restore();
    const writing = assert.rejects(
      session.save(rotated, session.getVersion()),
      SessionExpiredError,
    );
    await started.promise;
    const clearing = session.clear();
    release.resolve();
    await Promise.all([writing, clearing]);
    assert.equal(storage.value(), null);
    assert.equal(session.getTokens(), null);
  },
);

test(
  "an old-account 401 cannot invalidate a newer login",
  bounded,
  async () => {
    const { api, session } = await setup();
    const started = deferred();
    const release = deferred();
    api.defaults.adapter = async (config) => {
      started.resolve();
      await release.promise;
      return reject(config);
    };
    const old = assert.rejects(api.get("/protected"), SessionExpiredError);
    await started.promise;
    const version = await session.beginLogin();
    await session.save(rotated, version);
    release.resolve();
    await old;
    assert.deepEqual(session.getTokens(), rotated);
  },
);

test(
  "successful data from a previous session is discarded after logout",
  bounded,
  async () => {
    const { api, session } = await setup();
    const started = deferred();
    const release = deferred();
    api.defaults.adapter = async (config) => {
      started.resolve();
      await release.promise;
      return response(config, { private: true });
    };
    const old = assert.rejects(api.get("/protected"), SessionExpiredError);
    await started.promise;
    await session.clear();
    release.resolve();
    await old;
  },
);

test(
  "login uses a client without refresh interception or bearer credentials",
  bounded,
  async () => {
    const { publicApi, session } = await setup();
    let calls = 0;
    publicApi.defaults.adapter = async (config) => {
      calls++;
      assert.equal(config.url, "/auth/login");
      assert.equal(config.headers.Authorization, undefined);
      return reject(config);
    };
    await assert.rejects(
      publicApi.post("/auth/login", {
        email: "test@example.com",
        password: "unused",
      }),
    );
    assert.equal(calls, 1);
    assert.deepEqual(session.getTokens(), original);
  },
);

test(
  "partial stored credentials are cleared instead of entering protected screens",
  bounded,
  async () => {
    const { session, storage } = await setup({ accessToken: "orphan" });
    assert.equal(session.getTokens(), null);
    assert.equal(storage.value(), null);
  },
);

test(
  "failed token persistence invalidates the in-memory session",
  bounded,
  async () => {
    const { session, storage } = await setup();
    storage.saveTokens = async () => {
      throw new Error("Storage unavailable");
    };
    await assert.rejects(session.save(rotated, session.getVersion()));
    assert.equal(session.getTokens(), null);
    assert.equal(storage.value(), null);
  },
);

test("UI errors never expose server messages or Axios configuration", () => {
  const error = new axios.AxiosError(
    "secret request details",
    undefined,
    {},
    undefined,
    { status: 500, data: { message: ["internal database error"] } },
  );
  assert.equal(
    getErrorMessage(error, "Intenta de nuevo."),
    "El servicio no está disponible por el momento. Intenta más tarde.",
  );
});
