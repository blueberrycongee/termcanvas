# Login & Usage Sync Design

## Context

TermCanvas is a local-first Electron terminal app. All data (usage stats, state, preferences) is stored locally in `~/.termcanvas/`. Users who develop across multiple machines have no way to see aggregated usage data.

## Goal

Add optional GitHub login via Supabase so that usage statistics are aggregated across devices for a single user. Target scale: < 200 users initially.

## Decisions

| Decision | Choice |
|----------|--------|
| Backend | Supabase (Auth + PostgreSQL) |
| Login method | GitHub OAuth |
| Login requirement | Optional — app works fully offline without login |
| Data source | Logged in → Supabase, logged out → local |
| Sync direction | Upload only, no write-back to local |
| Display | Global aggregate + per-device breakdown (current device labeled) |

## Authentication Flow

1. User clicks "Login" → Electron calls `shell.openExternal(supabaseOAuthURL)`
2. User authorizes on GitHub in browser → Supabase redirects to `termcanvas://auth/callback`
3. Electron registers `termcanvas://` protocol, captures callback, extracts session token
4. Token stored in `~/.termcanvas/auth.json`
5. Subsequent Supabase requests use this token
6. Logout clears local token, stops sync, reverts to local-only mode

Fallback: if protocol registration fails, use a local HTTP server to receive the callback.

## Data Model

```sql
create table usage_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) not null,
  device_id     text not null,
  model         text not null,
  project       text,
  input_tokens  int default 0,
  output_tokens int default 0,
  cost_usd      numeric(10,6) default 0,
  recorded_at   timestamptz not null,
  created_at    timestamptz default now()
);

alter table usage_records enable row level security;
create policy "users own their data" on usage_records
  for all using (auth.uid() = user_id);

create index idx_usage_user_time on usage_records(user_id, recorded_at);
```

- `device_id`: UUID generated on first launch, stored at `~/.termcanvas/device-id`
- `recorded_at`: original local timestamp when usage was recorded

## Sync Strategy

### Upload

- `usage-collector.ts` writes to local `usage.jsonl` as before
- If logged in, `usage-sync.ts` simultaneously inserts to Supabase
- Failed uploads are queued in `~/.termcanvas/sync-queue.jsonl` and retried on next successful connection

### History Backfill

- On first login, batch insert existing `usage.jsonl` records to Supabase
- Deduplicate using `device_id + recorded_at`
- Mark completion with `~/.termcanvas/sync-backfilled` flag to avoid re-running

### No Download Sync

Cloud data is read-only from the client's perspective (for display). Local `usage.jsonl` continues to be written for offline resilience but is not the display source when logged in.

## UsagePanel Display

### Logged In

- **Top-level stats**: aggregated across all devices (total tokens, total cost, etc.)
- **Device breakdown**: grouped by device_id, each showing its own usage. Current device is labeled "(this device)"
- **Charts/heatmaps**: based on global aggregated data

### Logged Out

No changes — displays local `usage.jsonl` data exactly as today.

## Client Architecture

### New Files

```
electron/
  auth.ts          -- Supabase client init, OAuth flow, token management
  usage-sync.ts    -- Upload logic, offline queue, history backfill

src/
  stores/authStore.ts       -- Login state, user info (Zustand)
  components/LoginButton.tsx -- Login/logout UI
```

### Preload Bridge Extension

```ts
termcanvas.auth = {
  login(),
  logout(),
  getUser(),
  onAuthChange(cb),
}
```

### Modified Files

- `electron/main.ts`: init auth module, register `termcanvas://` protocol
- `electron/preload.ts`: expose auth API
- `electron/usage-collector.ts`: call `usage-sync.ts` after local write
- `src/components/UsagePanel.tsx`: switch data source based on auth state

### Unchanged

- Local `usage.jsonl` write logic
- Preferences, canvas state, all non-usage features
- Entire app behavior when not logged in

## Error Handling

- **Network failure**: queue failed uploads, retry later
- **Supabase query timeout**: fallback to local data, show "data may be incomplete" hint
- **Token expiry**: Supabase SDK auto-refreshes; if refresh fails, revert to logged-out state with re-login prompt
- **Protocol conflict**: fallback to localhost HTTP callback listener
