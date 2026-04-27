/**
 * Outcome of an `updater:check` IPC call. Returned by both the macOS
 * custom updater and the electron-updater path so the front-end can
 * tell "actually up to date" from "couldn't check" without having to
 * infer it from the absence of a status change.
 *
 * - `up-to-date`: confirmed on the latest published version. Show
 *   "已是最新" / "Up to date" feedback.
 * - `newer`: a newer version was found and is being / has been
 *   downloaded; UI is driven by the `update-available` /
 *   `download-progress` / `update-downloaded` events.
 * - `skipped`: the check did NOT confirm latest — could be the app
 *   running from a read-only location, a network/yml failure, or an
 *   in-flight download. The companion `updater:location-warning` /
 *   `updater:error` events carry the actual reason. Front-end should
 *   NOT render this as "up to date".
 */
export type UpdateCheckOutcome = "up-to-date" | "newer" | "skipped";
