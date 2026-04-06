import { useT } from "../i18n/useT";

export function HydraPanel() {
  const t = useT();

  return (
    <div className="flex flex-col h-full p-3 text-[var(--text-secondary)]">
      <p className="text-xs">{t.hydra_tab}</p>
    </div>
  );
}
