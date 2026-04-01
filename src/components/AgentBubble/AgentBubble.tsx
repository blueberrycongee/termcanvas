import { useCallback, useState } from "react";
import { BubbleButton } from "./BubbleButton";
import { ChatPanel } from "./ChatPanel";
import type { AgentBubbleProps } from "./types";

export function AgentBubble({ onSendMessage, messages, activeTaskCount }: AgentBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const handleExpand = useCallback(() => setExpanded(true), []);
  const handleCollapse = useCallback(() => setExpanded(false), []);

  return (
    <>
      {/* Collapsed bubble button */}
      <div
        className="transition-all duration-150 ease-out"
        style={{
          opacity: expanded ? 0 : 1,
          transform: expanded ? "scale(0.95)" : "scale(1)",
          pointerEvents: expanded ? "none" : "auto",
        }}
      >
        <BubbleButton activeTaskCount={activeTaskCount} onExpand={handleExpand} />
      </div>

      {/* Expanded chat panel */}
      {expanded && (
        <div
          className="animate-[usage-fade-in-up_200ms_ease-out]"
        >
          <ChatPanel
            messages={messages}
            onSendMessage={onSendMessage}
            onCollapse={handleCollapse}
          />
        </div>
      )}
    </>
  );
}
