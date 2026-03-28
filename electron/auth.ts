import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { shell } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { TERMCANVAS_DIR } from "./state-persistence";
import { startOAuthCallbackServer, type CallbackResult } from "./oauth-callback-server";

// ── Types ──

interface AuthUser {
  id: string;
  username: string;
  avatarUrl: string;
  email: string;
}

type AuthStateCallback = (user: AuthUser | null) => void;
type LoginResult = { ok: boolean; url?: string; error?: string };

// ── Constants ──

// Injected at build time via vite.config.ts define (replaces process.env.VITE_*)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? "";

const AUTH_FILE = path.join(TERMCANVAS_DIR, "auth.json");
// Device ID is always in ~/.termcanvas/ (not ~/.termcanvas-dev/) so that
// dev and production instances on the same machine share the same identity
// and don't double-count usage records uploaded to Supabase.
const DEVICE_ID_DIR = path.join(os.homedir(), ".termcanvas");
const DEVICE_ID_FILE = path.join(DEVICE_ID_DIR, "device-id");

// ── State ──

let supabase: SupabaseClient | null = null;
let currentUser: AuthUser | null = null;
let deviceId: string = "";
const listeners: Set<AuthStateCallback> = new Set();

// ── Helpers ──

function isConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
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
    if (!fs.existsSync(DEVICE_ID_DIR)) {
      fs.mkdirSync(DEVICE_ID_DIR, { recursive: true });
    }
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
  const username = (
    meta.user_name ??
    meta.preferred_username ??
    meta.login ??
    meta.name ??
    meta.full_name ??
    user.email?.split("@")[0] ??
    ""
  ) as string;
  return {
    id: user.id,
    username,
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

/**
 * Process the result from the OAuth callback server.
 * Exchanges the authorization code for a session, or surfaces errors.
 */
async function processCallbackResult(result: CallbackResult): Promise<LoginResult> {
  if (!supabase) {
    return { ok: false, error: "Auth not configured" };
  }

  switch (result.type) {
    case "error": {
      const msg = `OAuth error: ${result.error} — ${result.description}`;
      console.error(`[Auth] ${msg}`);
      return { ok: false, error: result.description };
    }

    case "timeout": {
      const msg = "Login timed out. The browser authorization took too long — please try again.";
      console.error(`[Auth] ${msg}`);
      return { ok: false, error: msg };
    }

    case "success": {
      try {
        console.log("[Auth] Exchanging authorization code for session...");
        const { data, error } = await supabase.auth.exchangeCodeForSession(result.code);

        if (error) {
          console.error("[Auth] Code exchange failed:", error.message);
          return { ok: false, error: `Login failed: ${error.message}` };
        }

        if (data.session) {
          saveSession(data.session);
          const user = extractUser(data.session);
          setUser(user);
          console.log("[Auth] Login successful, user:", user?.username);
          return { ok: true };
        }

        console.error("[Auth] Code exchange returned no session");
        return { ok: false, error: "Login failed: no session returned" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Auth] Code exchange error:", msg);
        return { ok: false, error: `Login failed: ${msg}` };
      }
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

export async function login(): Promise<LoginResult> {
  if (!supabase) {
    console.warn("[Auth] Supabase not configured, cannot login");
    return { ok: false, error: "Auth not configured" };
  }

  try {
    // Start the local callback server before generating the OAuth URL,
    // so the redirect URL is ready when the browser redirects back.
    const { port, resultPromise, shutdown } = startOAuthCallbackServer();
    const redirectUrl = `http://127.0.0.1:${port}/callback`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      console.error("[Auth] OAuth error:", error.message);
      shutdown();
      return { ok: false, error: error.message };
    }

    if (!data.url) {
      shutdown();
      return { ok: false, error: "Failed to generate OAuth URL" };
    }

    // Log the OAuth URL for debugging PKCE issues
    const oauthUrl = new URL(data.url);
    console.log(
      `[Auth] OAuth URL generated (code_challenge present: ${oauthUrl.searchParams.has("code_challenge")})`,
    );

    try {
      await shell.openExternal(data.url);
    } catch (err) {
      console.error("[Auth] Failed to open browser:", err);
      shutdown();
      return { ok: false, url: data.url, error: "Failed to open browser" };
    }

    const result = await resultPromise;
    return await processCallbackResult(result);
  } catch (err) {
    console.error("[Auth] Login failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
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
      flowType: "pkce",
    },
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      saveSession(session);
      setUser(extractUser(session));
    } else {
      clearSession();
      setUser(null);
    }
  });

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
    // Parse the callback URL to extract tokens or error info
    // Supabase redirects with fragment: termcanvas://auth/callback#access_token=...&refresh_token=...
    // Or with error: termcanvas://auth/callback#error=xxx&error_description=yyy
    // URL constructor may not parse custom protocols well, so handle manually
    const hashIndex = url.indexOf("#");
    const queryIndex = url.indexOf("?");
    const paramsString = hashIndex !== -1
      ? url.slice(hashIndex + 1)
      : queryIndex !== -1
        ? url.slice(queryIndex + 1)
        : "";

    const params = new URLSearchParams(paramsString);

    const error = params.get("error");
    const errorDescription = params.get("error_description");
    if (error) {
      console.error(
        `[Auth] OAuth callback error: ${error} — ${errorDescription ?? "no description"}`,
      );
      return;
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      console.error("[Auth] Callback missing tokens. Params:", paramsString);
      return;
    }

    const { data, error: setError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (setError) {
      console.error("[Auth] Failed to set session from callback:", setError.message);
      return;
    }

    if (data.session) {
      saveSession(data.session);
      setUser(extractUser(data.session));
      console.log("[Auth] Login successful, user:", extractUser(data.session)?.username);
    }
  } catch (err) {
    console.error("[Auth] Callback handling error:", err);
  }
}
