/**
 * Command palette action registry.
 *
 * The single file API. Add a new capability by appending one entry — do
 * NOT edit the palette UI to surface it. Each entry is a `PaletteCommand`:
 * a stable id, a section, a title (and optional subtitle/keywords), an
 * optional shortcut hint chip, and a `perform` thunk. Dynamic sources
 * (open terminals, projects, waypoints) walk live store state at call
 * time so the palette always reflects the current scene.
 *
 * Why a single file: the palette is the discovery surface for *future*
 * features. If adding "wire feature X to the palette" requires editing
 * components/CommandPalette internals, the surface stops compounding.
 * Every entry is local to this module; the UI is generic.
 */

import { promptAndAddProjectToScene } from "../../canvas/sceneCommands";
import {
  fitAllProjects,
  setZoomToHundred,
} from "../../canvas/zoomActions";
import { createBrowserCardInScene } from "../../actions/sceneCardActions";
import {
  stashTerminalInScene,
  toggleTerminalStarredInScene,
} from "../../actions/terminalSceneActions";
import {
  saveWaypointToActiveProject,
  recallWaypointFromActiveProject,
  getActiveWaypointProjectId,
  WAYPOINT_SLOTS,
} from "../../actions/spatialWaypointActions";
import { panToTerminal } from "../../utils/panToTerminal";
import { panToWorktree } from "../../utils/panToWorktree";
import { useCanvasStore } from "../../stores/canvasStore";
import { usePreferencesStore } from "../../stores/preferencesStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSearchStore } from "../../stores/searchStore";
import { useSettingsModalStore } from "../../stores/settingsModalStore";
import { useThemeStore } from "../../stores/themeStore";
import { rebuildTerminalAtlas } from "../../terminal/webglContextPool";
import { refreshRegisteredTerminalViewports } from "../../terminal/terminalRegistry";
import {
  formatShortcut,
  useShortcutStore,
} from "../../stores/shortcutStore";
import type { useT } from "../../i18n/useT";

export type CommandSection = "action" | "terminal" | "project" | "waypoint";

export interface PaletteCommand {
  id: string;
  section: CommandSection;
  title: string;
  subtitle?: string;
  /** Right-aligned shortcut hint chip (e.g. "⌘O"). Optional. */
  hint?: string;
  /** Extra terms folded into the fuzzy match. Synonyms, abbreviations. */
  keywords?: string[];
  perform: () => void;
}

export interface CommandContext {
  t: ReturnType<typeof useT>;
  isMac: boolean;
}

function shortcutHint(
  key: keyof ReturnType<typeof useShortcutStore.getState>["shortcuts"],
  isMac: boolean,
): string | undefined {
  const value = useShortcutStore.getState().shortcuts[key];
  if (!value) return undefined;
  return formatShortcut(value, isMac);
}

function findFocusedTerminal():
  | { projectId: string; worktreeId: string; terminalId: string }
  | null {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.focused) {
          return {
            projectId: p.id,
            worktreeId: w.id,
            terminalId: t.id,
          };
        }
      }
    }
  }
  return null;
}

function actionCommands(ctx: CommandContext): PaletteCommand[] {
  const { isMac } = ctx;
  const settings = useSettingsModalStore.getState();
  const canvas = useCanvasStore.getState();
  const prefs = usePreferencesStore.getState();
  const focusedTerminal = findFocusedTerminal();

  const list: PaletteCommand[] = [
    {
      id: "open-settings",
      section: "action",
      title: "Open Settings",
      keywords: ["preferences", "config", "options"],
      perform: () => settings.openSettings(),
    },
    {
      id: "open-shortcuts",
      section: "action",
      title: "Keyboard Shortcuts",
      keywords: ["keybindings", "hotkeys", "bindings"],
      perform: () => settings.openSettings("shortcuts"),
    },
    {
      id: "add-project",
      section: "action",
      title: "Add Project Folder…",
      keywords: ["open", "new", "folder", "directory", "import"],
      hint: shortcutHint("addProject", isMac),
      perform: () => {
        void promptAndAddProjectToScene(ctx.t, { notifyAdded: true });
      },
    },
    {
      id: "toggle-theme",
      section: "action",
      title: "Toggle Theme (Light / Dark)",
      keywords: ["dark", "light", "appearance", "color"],
      perform: () => useThemeStore.getState().toggleTheme(),
    },
    {
      id: "fit-all",
      section: "action",
      title: "Fit All Projects",
      keywords: ["zoom", "view", "overview"],
      hint: isMac ? "⌘ 0" : "Ctrl 0",
      perform: () => fitAllProjects(),
    },
    {
      id: "zoom-100",
      section: "action",
      title: "Zoom 100%",
      keywords: ["actual size", "reset zoom"],
      hint: isMac ? "⌘ 1" : "Ctrl 1",
      perform: () => setZoomToHundred(),
    },
    {
      id: "toggle-right-panel",
      section: "action",
      title: canvas.rightPanelCollapsed
        ? "Show Right Panel"
        : "Hide Right Panel",
      keywords: ["sidebar", "files", "git", "diff", "memory"],
      hint: shortcutHint("toggleRightPanel", isMac),
      perform: () =>
        useCanvasStore
          .getState()
          .setRightPanelCollapsed(
            !useCanvasStore.getState().rightPanelCollapsed,
          ),
    },
    {
      id: "toggle-left-panel",
      section: "action",
      title: canvas.leftPanelCollapsed
        ? "Show Left Panel"
        : "Hide Left Panel",
      keywords: ["sidebar", "projects", "tree"],
      perform: () =>
        useCanvasStore
          .getState()
          .setLeftPanelCollapsed(
            !useCanvasStore.getState().leftPanelCollapsed,
          ),
    },
    {
      id: "show-files-tab",
      section: "action",
      title: "Show Files",
      keywords: ["explorer", "tree"],
      perform: () => {
        const c = useCanvasStore.getState();
        c.setRightPanelCollapsed(false);
        c.setRightPanelActiveTab("files");
      },
    },
    {
      id: "show-git-tab",
      section: "action",
      title: "Show Git",
      keywords: ["source control", "branches", "commits"],
      perform: () => {
        const c = useCanvasStore.getState();
        c.setRightPanelCollapsed(false);
        c.setRightPanelActiveTab("git");
      },
    },
    {
      id: "show-diff-tab",
      section: "action",
      title: "Show Diff",
      keywords: ["changes", "patch"],
      perform: () => {
        const c = useCanvasStore.getState();
        c.setRightPanelCollapsed(false);
        c.setRightPanelActiveTab("diff");
      },
    },
    {
      id: "show-memory-tab",
      section: "action",
      title: "Show Memory",
      keywords: ["context", "claude.md"],
      perform: () => {
        const c = useCanvasStore.getState();
        c.setRightPanelCollapsed(false);
        c.setRightPanelActiveTab("memory");
      },
    },
    {
      id: "toggle-sessions-overlay",
      section: "action",
      title: canvas.sessionsOverlayOpen
        ? "Close Sessions"
        : "Open Sessions",
      keywords: ["history", "replay"],
      hint: shortcutHint("toggleSessionsOverlay", isMac),
      perform: () => useCanvasStore.getState().toggleSessionsOverlay(),
    },
    {
      id: "toggle-usage-overlay",
      section: "action",
      title: canvas.usageOverlayOpen ? "Close Usage" : "Open Usage",
      keywords: ["cost", "tokens", "consumption"],
      hint: shortcutHint("toggleUsageOverlay", isMac),
      perform: () => useCanvasStore.getState().toggleUsageOverlay(),
    },
    {
      id: "toggle-global-search",
      section: "action",
      title: prefs.globalSearchEnabled
        ? "Disable Global Search"
        : "Enable Global Search",
      keywords: ["full text", "find", "ripgrep"],
      perform: () => {
        const next = !usePreferencesStore.getState().globalSearchEnabled;
        usePreferencesStore.getState().setGlobalSearchEnabled(next);
        if (next) {
          useSearchStore.getState().openSearch();
        }
      },
    },
    {
      id: "toggle-composer",
      section: "action",
      title: prefs.composerEnabled ? "Disable Composer" : "Enable Composer",
      keywords: ["prompt bar", "input"],
      perform: () =>
        usePreferencesStore
          .getState()
          .setComposerEnabled(
            !usePreferencesStore.getState().composerEnabled,
          ),
    },
    {
      id: "toggle-drawing",
      section: "action",
      title: prefs.drawingEnabled
        ? "Disable Drawing"
        : "Enable Drawing",
      keywords: ["annotate", "sketch", "pen"],
      perform: () =>
        usePreferencesStore
          .getState()
          .setDrawingEnabled(
            !usePreferencesStore.getState().drawingEnabled,
          ),
    },
    {
      id: "toggle-completion-glow",
      section: "action",
      title: prefs.completionGlowEnabled
        ? "Disable Completion Glow"
        : "Enable Completion Glow",
      keywords: ["highlight", "agent done"],
      perform: () =>
        usePreferencesStore
          .getState()
          .setCompletionGlowEnabled(
            !usePreferencesStore.getState().completionGlowEnabled,
          ),
    },
    {
      id: "toggle-activity-heatmap",
      section: "action",
      title: "Toggle activity heatmap",
      subtitle: prefs.activityHeatmapEnabled
        ? "Currently ON — output sparklines visible per tile"
        : "Reveal a quiet 5-minute output sparkline on every tile",
      keywords: ["sparkline", "ambient", "indicator", "busy", "idle", "output"],
      hint: shortcutHint("toggleActivityHeatmap", isMac),
      perform: () =>
        usePreferencesStore
          .getState()
          .setActivityHeatmapEnabled(
            !usePreferencesStore.getState().activityHeatmapEnabled,
          ),
    },
    {
      id: "toggle-pet",
      section: "action",
      title: prefs.petEnabled ? "Disable Pet" : "Enable Pet",
      keywords: ["companion", "fun"],
      perform: () =>
        usePreferencesStore
          .getState()
          .setPetEnabled(!usePreferencesStore.getState().petEnabled),
    },
  ];

  if (prefs.browserEnabled) {
    list.push({
      id: "open-browser-card",
      section: "action",
      title: "Add Browser to Canvas",
      keywords: ["web", "open browser", "internet"],
      perform: () => {
        createBrowserCardInScene("https://google.com");
      },
    });
  }

  if (prefs.terminalRenderer === "webgl") {
    list.push({
      id: "refresh-terminal-rendering",
      section: "action",
      title: "Refresh Terminal Rendering",
      keywords: ["redraw", "atlas", "glyph", "webgl"],
      perform: () => {
        rebuildTerminalAtlas();
        refreshRegisteredTerminalViewports();
      },
    });
  }

  if (focusedTerminal) {
    list.push(
      {
        id: "star-focused-terminal",
        section: "action",
        title: "Star Focused Terminal",
        keywords: ["pin", "favorite", "bookmark"],
        hint: shortcutHint("toggleStarFocused", isMac),
        perform: () =>
          toggleTerminalStarredInScene(
            focusedTerminal.projectId,
            focusedTerminal.worktreeId,
            focusedTerminal.terminalId,
          ),
      },
      {
        id: "stash-focused-terminal",
        section: "action",
        title: "Stash Focused Terminal",
        keywords: ["minimize", "hide", "tuck"],
        perform: () =>
          stashTerminalInScene(
            focusedTerminal.projectId,
            focusedTerminal.worktreeId,
            focusedTerminal.terminalId,
          ),
      },
    );
  }

  return list;
}

function terminalCommands(): PaletteCommand[] {
  const { projects } = useProjectStore.getState();
  const list: PaletteCommand[] = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const term of w.terminals) {
        if (term.stashed) continue;
        const label = term.customTitle || term.title || term.type;
        list.push({
          id: `terminal:${term.id}`,
          section: "terminal",
          title: label,
          subtitle: `${p.name} · ${w.name}`,
          keywords: [term.type, p.name, w.name],
          perform: () => {
            panToTerminal(term.id);
          },
        });
      }
    }
  }
  return list;
}

function projectCommands(): PaletteCommand[] {
  const { projects } = useProjectStore.getState();
  return projects.map((p) => {
    const primary = p.worktrees.find((w) => w.isPrimary) ?? p.worktrees[0];
    return {
      id: `project:${p.id}`,
      section: "project",
      title: p.name,
      subtitle: p.path,
      keywords: ["project", "switch", "go to"],
      perform: () => {
        if (primary) {
          panToWorktree(p.id, primary.id);
        }
      },
    } satisfies PaletteCommand;
  });
}

function waypointCommands(): PaletteCommand[] {
  const projectId = getActiveWaypointProjectId();
  if (!projectId) return [];

  const project = useProjectStore
    .getState()
    .projects.find((p) => p.id === projectId);
  if (!project) return [];

  const list: PaletteCommand[] = [];
  for (const slot of WAYPOINT_SLOTS) {
    const waypoint = project.waypoints?.[slot];
    if (waypoint) {
      list.push({
        id: `waypoint:jump:${slot}`,
        section: "waypoint",
        title: `Jump to Waypoint ${slot}`,
        subtitle: project.name,
        hint: `⌥ ${slot}`,
        keywords: ["wp", "viewport", "go to", "fly"],
        perform: () => {
          recallWaypointFromActiveProject(slot);
        },
      });
    }
    list.push({
      id: `waypoint:save:${slot}`,
      section: "waypoint",
      title: `Save Waypoint to Slot ${slot}`,
      subtitle: project.name,
      hint: `⇧⌘ ${slot}`,
      keywords: ["wp", "viewport", "bookmark"],
      perform: () => {
        saveWaypointToActiveProject(slot);
      },
    });
  }
  return list;
}

export function buildCommands(ctx: CommandContext): PaletteCommand[] {
  return [
    ...actionCommands(ctx),
    ...terminalCommands(),
    ...projectCommands(),
    ...waypointCommands(),
  ];
}

export const SECTION_ORDER: CommandSection[] = [
  "action",
  "terminal",
  "project",
  "waypoint",
];

export const SECTION_LABEL: Record<CommandSection, string> = {
  action: "Actions",
  terminal: "Open Terminals",
  project: "Projects",
  waypoint: "Waypoints",
};

export const SECTION_GLYPH: Record<CommandSection, string> = {
  action: "A",
  terminal: "T",
  project: "P",
  waypoint: "W",
};
