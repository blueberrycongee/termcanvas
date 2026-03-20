import { useT } from "../../i18n/useT";
import type { DeviceUsage } from "../../types";

function fmtCost(c: number): string {
  return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface DeviceBreakdownProps {
  devices: DeviceUsage[];
  localDeviceId: string | null;
}

export function DeviceBreakdown({ devices, localDeviceId }: DeviceBreakdownProps) {
  const t = useT();

  if (devices.length === 0) return null;

  const maxCost = Math.max(...devices.map((d) => d.cost), 0.001);

  return (
    <div className="px-3 py-2.5">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.auth_devices}
      </span>
      <div className="mt-2 flex flex-col gap-1.5">
        {devices.map((device, i) => {
          const shortId = device.deviceId.slice(0, 8);
          const isLocal = device.deviceId === localDeviceId;
          const w = maxCost > 0 ? Math.max(0, Math.min(100, (device.cost / maxCost) * 100)) : 0;

          return (
            <div key={device.deviceId} className="flex items-center gap-2">
              <span
                className="text-[10px] text-[var(--text-muted)] shrink-0 truncate"
                style={{ fontFamily: '"Geist Mono", monospace', maxWidth: "40%" }}
              >
                {shortId}
                {isLocal && (
                  <span className="text-[var(--accent)] ml-0.5">{t.auth_this_device}</span>
                )}
              </span>
              <div className="h-1.5 rounded-full bg-[var(--border)] flex-1 min-w-0 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${w}%`,
                    backgroundColor: isLocal ? "var(--accent)" : "#6b7280",
                    transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                    animation: `usage-bar-fill 0.5s ease-out ${i * 60}ms both`,
                  }}
                />
              </div>
              <span
                className="text-[10px] text-[var(--text-muted)] shrink-0 tabular-nums text-right"
                style={{ fontFamily: '"Geist Mono", monospace', minWidth: 40 }}
              >
                {fmtCost(device.cost)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
