import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { shell } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { TERMCANVAS_DIR } from "./state-persistence";

// ── Types ──

interface AuthUser {
  id: string;
  username: string;
  avatarUrl: string;
  email: string;
}

type AuthStateCallback = (user: AuthUser | null) => void;

// ── Constants ──

// TODO: Replace with actual Supabase credentials
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? "YOUR_SUPABASE_ANON_KEY";

const AUTH_FILE = path.join(TERMCANVAS_DIR, "auth.json");
const DEVICE_ID_FILE = path.join(TERMCANVAS_DIR, "device-id");

// ── State ──

let supabase: SupabaseClient | null = null;
let currentUser: AuthUser | null = null;
let deviceId: string = "";
const listeners: Set<AuthStateCallback> = new Set();

// ── Helpers ──

function isConfigured(): boolean {
  return SUPABASE_URL !== "YOUR_SUPABASE_URL" && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";
}

function ensureDir(): void {
  if (!fs.existsSync(TERMCANVAS_DIR)) {
    fs.mkdirSync(TERMCANVAS_DIR, { recursive: true });
  }
}

function saveSession(session: Session): void {
  try {
    ensureDir();
    const tmp = AUTH_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2), "utf-8");
    fs.renameSync(tmp, AUTH_FILE);
    console.log("[Auth] Session saved");
  } catch (err) {
    console.error("[Auth] Failed to save session:", err);
  }
}

function loadSession(): Session | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const data = fs.readFileSync(AUTH_FILE, "utf-8");
    return JSON.parse(data) as Session;
  } catch (err) {
    console.error("[Auth] Failed to load session:", err);
    return null;
  }
}

function clearSession(): void {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
    console.log("[Auth] Session cleared");
  } catch (err) {
    console.error("[Auth] Failed to clear session:", err);
  }
}

function loadOrCreateDeviceId(): string {
  try {
    ensureDir();
    if (fs.existsSync(DEVICE_ID_FILE)) {
      return fs.readFileSync(DEVICE_ID_FILE, "utf-8").trim();
    }
    const id = crypto.randomUUID();
    fs.writeFileSync(DEVICE_ID_FILE, id, "utf-8");
    console.log("[Auth] Generated device ID");
    return id;
  } catch (err) {
    console.error("[Auth] Failed to manage device ID:", err);
    return crypto.randomUUID();
  }
}

function extractUser(session: Session): AuthUser | null {
  const { user } = session;
  if (!user) return null;

  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    username: (meta.user_name ?? meta.preferred_username ?? "") as string,
    avatarUrl: (meta.avatar_url ?? "") as string,
    email: user.email ?? "",
  };
}

function setUser(user: AuthUser | null): void {
  currentUser = user;
  for (const cb of listeners) {
    try {
      cb(user);
    } catch (err) {
      console.error("[Auth] Listener error:", err);
    }
  }
}

// ── Public API ──

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

export function getAuthUser(): AuthUser | null {
  return currentUser;
}

export function getDeviceId(): string {
  return deviceId;
}

export function isLoggedIn(): boolean {
  return currentUser !== null;
}

export async function login(): Promise<void> {
  if (!supabase) {
    console.warn("[Auth] Supabase not configured, cannot login");
    return;
  }

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: "termcanvas://auth/callback",
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      console.error("[Auth] OAuth error:", error.message);
      return;
    }

    if (data.url) {
      await shell.openExternal(data.url);
    }
  } catch (err) {
    console.error("[Auth] Login failed:", err);
  }
}

export async function logout(): Promise<void> {
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[Auth] Supabase signOut error:", err);
    }
  }

  clearSession();
  setUser(null);
  console.log("[Auth] Logged out");
}

export async function initAuth(): Promise<void> {
  deviceId = loadOrCreateDeviceId();
  console.log("[Auth] Device ID loaded");

  if (!isConfigured()) {
    console.log("[Auth] Supabase not configured, skipping auth init");
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: false, // We handle persistence ourselves
    },
  });

  // Listen for auth state changes from the Supabase client
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      saveSession(session);
      setUser(extractUser(session));
    } else {
      clearSession();
      setUser(null);
    }
  });

  // Attempt to restore saved session
  const saved = loadSession();
  if (saved) {
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
      });

      if (error) {
        console.error("[Auth] Failed to restore session:", error.message);
        clearSession();
      } else if (data.session) {
        console.log("[Auth] Session restored");
      }
    } catch (err) {
      console.error("[Auth] Session restore error:", err);
      clearSession();
    }
  }
}

export function onAuthStateChange(cb: AuthStateCallback): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function handleAuthCallback(url: string): Promise<void> {
  if (!supabase) {
    console.warn("[Auth] Supabase not configured, cannot handle callback");
    return;
  }

  try {
    // Parse the callback URL to extract tokens
    // Supabase redirects with fragment: termcanvas://auth/callback#access_token=...&refresh_token=...
    // URL constructor may not parse custom protocols well, so handle manually
    const hashIndex = url.indexOf("#");
    const queryIndex = url.indexOf("?");
    const paramsString = hashIndex !== -1
      ? url.slice(hashIndex + 1)
      : queryIndex !== -1
        ? url.slice(queryIndex + 1)
        : "";

    const params = new URLSearchParams(paramsString);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      console.error("[Auth] Callback missing tokens");
      return;
    }

    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error("[Auth] Failed to set session from callback:", error.message);
      return;
    }

    if (data.session) {
      console.log("[Auth] Login successful");
    }
  } catch (err) {
    console.error("[Auth] Callback handling error:", err);
  }
}
