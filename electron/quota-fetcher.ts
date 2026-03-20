import { execSync } from "child_process";
import https from "https";

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
const API_TIMEOUT_MS = 10000;

function getOAuthToken(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", timeout: KEYCHAIN_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const parsed = JSON.parse(raw);
    // Token may be nested: { default: { ... accessToken } } or flat { accessToken }
    const creds = parsed.default ?? parsed;
    return creds.accessToken ?? creds.access_token ?? null;
  } catch {
    return null;
  }
}

function fetchUsageApi(token: string): Promise<QuotaFetchResult> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/api/oauth/usage",
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        timeout: API_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode === 429) {
            resolve({ ok: false, rateLimited: true });
            return;
          }
          if (res.statusCode !== 200) {
            resolve({ ok: false, rateLimited: false });
            return;
          }
          try {
            const json: QuotaApiResponse = JSON.parse(body);
            resolve({
              ok: true,
              data: {
                fiveHour: {
                  utilization: json.five_hour.utilization,
                  resetsAt: json.five_hour.resets_at,
                },
                sevenDay: {
                  utilization: json.seven_day.utilization,
                  resetsAt: json.seven_day.resets_at,
                },
                fetchedAt: Date.now(),
              },
            });
          } catch {
            resolve({ ok: false, rateLimited: false });
          }
        });
      },
    );
    req.on("error", () => resolve({ ok: false, rateLimited: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, rateLimited: false });
    });
    req.end();
  });
}

export async function fetchQuota(): Promise<QuotaFetchResult> {
  const token = getOAuthToken();
  if (!token) return { ok: false, rateLimited: false };
  return fetchUsageApi(token);
}
