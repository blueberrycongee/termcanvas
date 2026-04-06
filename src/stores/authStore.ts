import { create } from "zustand";
import type { AuthUser } from "../types";

interface AuthStore {
  user: AuthUser | null;
  loading: boolean;
  deviceId: string | null;
  loginPending: boolean;
  loginError: string | null;
  loginFallbackUrl: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  init: () => Promise<void>;
  clearLoginError: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  deviceId: null,
  loginPending: false,
  loginError: null,
  loginFallbackUrl: null,

  init: async () => {
    if (!window.termcanvas?.auth) {
      set({ loading: false });
      return;
    }
    try {
      const [user, deviceId] = await Promise.all([
        window.termcanvas.auth.getUser(),
        window.termcanvas.auth.getDeviceId(),
      ]);
      set({ user, deviceId, loading: false });

      window.termcanvas.auth.onAuthStateChange((user: AuthUser | null) => {
        set({ user });
      });
    } catch {
      set({ loading: false });
    }
  },

  login: async () => {
    if (!window.termcanvas?.auth) return;
    set({ loginPending: true });
    try {
      const result = await window.termcanvas.auth.login();
      set({
        loginPending: false,
        loginError: result.ok ? null : (result.error ?? null),
        loginFallbackUrl: result.ok ? null : (result.url ?? null),
      });
    } catch {
      set({ loginPending: false, loginError: "Login failed", loginFallbackUrl: null });
    }
  },

  logout: async () => {
    if (!window.termcanvas?.auth) return;
    await window.termcanvas.auth.logout();
    set({ user: null });
  },

  clearLoginError: () => {
    set({ loginError: null, loginFallbackUrl: null });
  },
}));
