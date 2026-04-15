import type { SearchResult } from "../../stores/searchStore";
import { useSettingsModalStore } from "../../stores/settingsModalStore";
import { useCanvasStore } from "../../stores/canvasStore";

export interface ActionDef {
  id: string;
  titleKey: string;
  keywords: string[];
  perform: () => void;
}

export function getActionDefs(): ActionDef[] {
  return [
    {
      id: "open-settings",
      titleKey: "search_action_open_settings",
      keywords: ["settings", "preferences", "config", "设置"],
      perform: () => useSettingsModalStore.getState().openSettings(),
    },
    {
      id: "open-settings-shortcuts",
      titleKey: "search_action_open_shortcuts",
      keywords: ["shortcuts", "keybindings", "keyboard", "快捷键"],
      perform: () => useSettingsModalStore.getState().openSettings("shortcuts"),
    },
    {
      id: "toggle-right-panel",
      titleKey: "search_action_toggle_right_panel",
      keywords: ["panel", "sidebar", "sessions", "面板"],
      perform: () => {
        const s = useCanvasStore.getState();
        s.setRightPanelCollapsed(!s.rightPanelCollapsed);
      },
    },
    {
      id: "toggle-left-panel",
      titleKey: "search_action_toggle_left_panel",
      keywords: ["panel", "sidebar", "files", "git", "面板"],
      perform: () => {
        const s = useCanvasStore.getState();
        s.setLeftPanelCollapsed(!s.leftPanelCollapsed);
      },
    },
    {
      id: "tab-files",
      titleKey: "search_action_tab_files",
      keywords: ["files", "explorer", "文件"],
      perform: () => {
        useCanvasStore.getState().setLeftPanelCollapsed(false);
        useCanvasStore.getState().setLeftPanelActiveTab("files");
      },
    },
    {
      id: "tab-git",
      titleKey: "search_action_tab_git",
      keywords: ["git", "source control", "版本"],
      perform: () => {
        useCanvasStore.getState().setLeftPanelCollapsed(false);
        useCanvasStore.getState().setLeftPanelActiveTab("git");
      },
    },
    {
      id: "tab-diff",
      titleKey: "search_action_tab_diff",
      keywords: ["diff", "changes", "差异"],
      perform: () => {
        useCanvasStore.getState().setLeftPanelCollapsed(false);
        useCanvasStore.getState().setLeftPanelActiveTab("diff");
      },
    },
    {
      id: "tab-memory",
      titleKey: "search_action_tab_memory",
      keywords: ["memory", "context", "记忆"],
      perform: () => {
        useCanvasStore.getState().setLeftPanelCollapsed(false);
        useCanvasStore.getState().setLeftPanelActiveTab("memory");
      },
    },
  ];
}
