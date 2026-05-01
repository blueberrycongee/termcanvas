import { useT } from "../../i18n/useT";
import type { DeviceUsage } from "../../types";

function fmtCost(c: number): string {
  return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
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
    <div className="flex flex-col gap-1.5">
      {devices.map((device, i) => {
        const shortId = device.deviceId.slice(0, 8);
        const isLocal = device.deviceId === localDeviceId;
        const w = maxCost > 0 ? Math.max(0, Math.min(100, (device.cost / maxCost) * 100)) : 0;

        return (
          <div key={device.deviceId} className="flex items-center gap-2">
            <span
              className="text-[10px] text-[var(--text-secondary)] font-medium shrink-0 truncate tc-mono"
              style={{ maxWidth: "40%" }}
            >
              {shortId}
              {isLocal && (
                <span className="text-[var(--usage-secondary)] ml-1">{t.auth_this_device}</span>
              )}
            </span>
            <div className="h-1.5 rounded-full bg-[var(--border)] flex-1 min-w-0 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${w}%`,
                  backgroundColor: isLocal ? "var(--usage-secondary)" : "var(--usage-tertiary)",
                  transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                  animation: `usage-bar-fill 0.5s ease-out ${i * 60}ms both`,
                  opacity: isLocal ? 1 : 0.5,
                }}
              />
            </div>
            <span
              className="text-[10px] text-[var(--text-secondary)] font-medium shrink-0 text-right tc-mono tc-num"
              style={{ minWidth: 44 }}
            >
              {fmtCost(device.cost)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
