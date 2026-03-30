import { createRoot } from "react-dom/client";
import "./demo.css";
import { DemoAnimation } from "./DemoAnimation";

function WebsiteDemo() {
  return (
    <div className="flex items-center justify-center">
      <div
        className="rounded-md bg-[var(--bg)] overflow-hidden flex flex-col border border-[var(--border)] max-w-[800px] w-full shadow-2xl"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <div className="flex items-center gap-2 px-3 py-2 select-none shrink-0">
          <div className="w-[3px] h-3 rounded-full shrink-0" style={{ background: "rgba(212, 162, 78, 0.6)" }} />
          <span className="text-[11px] font-medium" style={{ color: "var(--cyan)" }}>demo</span>
          <span className="text-[11px] truncate flex-1" style={{ color: "var(--text-muted)" }}>termcanvas</span>
        </div>
        <DemoAnimation autoplay />
      </div>
    </div>
  );
}

const el = document.getElementById("demo-animation");
if (el) {
  createRoot(el).render(<WebsiteDemo />);
}
