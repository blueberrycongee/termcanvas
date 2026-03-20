import { create } from "zustand";

interface AuthUser {
  id: string;
  username: string;
  avatarUrl: string;
  email: string;
}

interface AuthStore {
  user: AuthUser | null;
  loading: boolean;
  deviceId: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  init: () => Promise<void>;
}

// The window.termcanvas.auth API is added by the preload agent in parallel.
// All auth property accesses use @ts-expect-error until the type declaration is merged.

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  deviceId: null,

  init: async () => {
    // @ts-expect-error -- auth API added by preload agent
    if (!window.termcanvas?.auth) {
      set({ loading: false });
      return;
    }
    try {
      const [user, deviceId] = await Promise.all([
        // @ts-expect-error -- auth API added by preload agent
        window.termcanvas.auth.getUser(),
        // @ts-expect-error -- auth API added by preload agent
        window.termcanvas.auth.getDeviceId(),
      ]);
      set({ user, deviceId, loading: false });

      // Listen for auth state changes
      // @ts-expect-error -- auth API added by preload agent
      window.termcanvas.auth.onAuthStateChange((user: AuthUser | null) => {
        set({ user });
      });
    } catch {
      set({ loading: false });
    }
  },

  login: async () => {
    // @ts-expect-error -- auth API added by preload agent
    if (!window.termcanvas?.auth) return;
    // @ts-expect-error -- auth API added by preload agent
    await window.termcanvas.auth.login();
  },

  logout: async () => {
    // @ts-expect-error -- auth API added by preload agent
    if (!window.termcanvas?.auth) return;
    // @ts-expect-error -- auth API added by preload agent
    await window.termcanvas.auth.logout();
    set({ user: null });
  },
}));
