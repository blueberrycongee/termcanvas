import test from "node:test";
import assert from "node:assert/strict";

import { useAuthStore } from "../src/stores/authStore.ts";

type AuthLoginResult = {
  ok: boolean;
  url?: string;
  error?: string;
};

function setAuthApi(login: () => Promise<AuthLoginResult>) {
  (globalThis as { window?: unknown }).window = {
    termcanvas: {
      auth: {
        login,
      },
    },
  };
}

function resetAuthStore() {
  useAuthStore.setState({
    user: null,
    loading: false,
    deviceId: null,
    loginPending: false,
    loginError: null,
    loginFallbackUrl: null,
  });
}

test("login tracks pending state and stores login failure details", async () => {
  resetAuthStore();
  setAuthApi(async () => {
    assert.equal(useAuthStore.getState().loginPending, true);
    return {
      ok: false,
      error: "Failed to open browser",
      url: "https://example.com/login",
    };
  });

  await useAuthStore.getState().login();

  const state = useAuthStore.getState();
  assert.equal(state.loginPending, false);
  assert.equal(state.loginError, "Failed to open browser");
  assert.equal(state.loginFallbackUrl, "https://example.com/login");
});

test("clearLoginError clears the login error and fallback URL", () => {
  resetAuthStore();
  useAuthStore.setState({
    loginError: "Auth not configured",
    loginFallbackUrl: "https://example.com/login",
  });

  useAuthStore.getState().clearLoginError();

  const state = useAuthStore.getState();
  assert.equal(state.loginError, null);
  assert.equal(state.loginFallbackUrl, null);
});
