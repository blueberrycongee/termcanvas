import { execFile } from "child_process";
import { promisify } from "util";

export interface QuotaApiResponse {
  five_hour: { utilization: number; resets_at: string };
  seven_day: { utilization: number; resets_at: string };
}

export interface QuotaData {
  fiveHour: { utilization: number; resetsAt: string };
  sevenDay: { utilization: number; resetsAt: string };
  fetchedAt: number;
}

export type QuotaFetchResult =
  | { ok: true; data: QuotaData }
  | { ok: false; rateLimited: boolean };

const KEYCHAIN_TIMEOUT_MS = 5000;
const API_TIMEOUT_MS = 15000;
const execFileAsync = promisify(execFile);

async function getOAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8", timeout: KEYCHAIN_TIMEOUT_MS },
    );
    const raw = stdout.trim();
    const parsed = JSON.parse(raw);
    // { default: { accessToken } }, or flat { accessToken }
    const creds = parsed.claudeAiOauth ?? parsed.default ?? parsed;
    return creds.accessToken ?? creds.access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchUsageApi(token: string): Promise<QuotaFetchResult> {
  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const statusCode = response.status;
    const body = await response.text();

    if (statusCode === 429) return { ok: false, rateLimited: true };
    if (statusCode !== 200) return { ok: false, rateLimited: false };

    const json: QuotaApiResponse = JSON.parse(body);
    return {
      ok: true,
      data: {
        fiveHour: {
          utilization: json.five_hour.utilization / 100,
          resetsAt: json.five_hour.resets_at,
        },
        sevenDay: {
          utilization: json.seven_day.utilization / 100,
          resetsAt: json.seven_day.resets_at,
        },
        fetchedAt: Date.now(),
      },
    };
  } catch {
    return { ok: false, rateLimited: false };
  }
}

export async function fetchQuota(): Promise<QuotaFetchResult> {
  const token = await getOAuthToken();
  if (!token) return { ok: false, rateLimited: false };
  return fetchUsageApi(token);
}
