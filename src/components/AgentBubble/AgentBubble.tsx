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
      {/* Collapsed bubble button — no wrapper with transform to avoid breaking fixed positioning */}
      {!expanded && (
        <BubbleButton activeTaskCount={activeTaskCount} onExpand={handleExpand} />
      )}

      {expanded && (
        <ChatPanel
          messages={messages}
          onSendMessage={onSendMessage}
          onCollapse={handleCollapse}
        />
      )}
    </>
  );
}
