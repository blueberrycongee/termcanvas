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
import { useSnapshotHistoryStore } from "../../stores/snapshotHistoryStore";
import { useThemeStore } from "../../stores/themeStore";
import { useHubStore } from "../../stores/hubStore";
import { useCanvasRegistryStore } from "../../stores/canvasRegistryStore";
import { useCanvasManagerStore } from "../../stores/canvasManagerStore";
import { rebuildTerminalAtlas } from "../../terminal/webglContextPool";
import { refreshRegisteredTerminalViewports } from "../../terminal/terminalRegistry";
import {
  formatShortcut,
  useShortcutStore,
} from "../../stores/shortcutStore";
import type { useT } from "../../i18n/useT";

export type CommandSection =
  | "action"
  | "canvas"
  | "terminal"
  | "project"
  | "waypoint";

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
  const { t, isMac } = ctx;
  const settings = useSettingsModalStore.getState();
  const canvas = useCanvasStore.getState();
  const prefs = usePreferencesStore.getState();
  const hub = useHubStore.getState();
  const focusedTerminal = findFocusedTerminal();

  const list: PaletteCommand[] = [
    {
      id: "toggle-hub",
      section: "action",
      title: hub.open
        ? t["palette.cmd.toggle_hub.open_title"]
        : t["palette.cmd.toggle_hub.closed_title"],
      subtitle: hub.open
        ? t["palette.cmd.toggle_hub.open_subtitle"]
        : t["palette.cmd.toggle_hub.closed_subtitle"],
      keywords: ["hub", "dashboard", "summary", "feed", "overview"],
      hint: shortcutHint("toggleHub", isMac),
      perform: () => useHubStore.getState().toggleHub(),
    },
    {
      id: "open-settings",
      section: "action",
      title: t.search_action_open_settings,
      keywords: ["preferences", "config", "options"],
      perform: () => settings.openSettings(),
    },
    {
      id: "open-shortcuts",
      section: "action",
      title: t.search_action_open_shortcuts,
      keywords: ["keybindings", "hotkeys", "bindings"],
      perform: () => settings.openSettings("shortcuts"),
    },
    {
      id: "add-project",
      section: "action",
      title: t.canvas_empty_action,
      keywords: ["open", "new", "folder", "directory", "import"],
      hint: shortcutHint("addProject", isMac),
      perform: () => {
        void promptAndAddProjectToScene(ctx.t, { notifyAdded: true });
      },
    },
    {
      id: "toggle-theme",
      section: "action",
      title: t["palette.cmd.toggle_theme"],
      keywords: ["dark", "light", "appearance", "color"],
      perform: () => useThemeStore.getState().toggleTheme(),
    },
    {
      id: "fit-all",
      section: "action",
      title: t["palette.cmd.fit_all"],
      keywords: ["zoom", "view", "overview"],
      hint: isMac ? "⌘ 0" : "Ctrl 0",
      perform: () => fitAllProjects(),
    },
    {
      id: "zoom-100",
      section: "action",
      title: t["palette.cmd.zoom_100"],
      keywords: ["actual size", "reset zoom"],
      hint: isMac ? "⌘ 1" : "Ctrl 1",
      perform: () => setZoomToHundred(),
    },
    {
      id: "toggle-right-panel",
      section: "action",
      title: canvas.rightPanelCollapsed
        ? t["palette.cmd.show_right_panel"]
        : t["palette.cmd.hide_right_panel"],
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
        ? t["palette.cmd.show_left_panel"]
        : t["palette.cmd.hide_left_panel"],
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
      title: t.search_action_tab_files,
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
      title: t.search_action_tab_git,
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
      title: t.search_action_tab_diff,
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
      title: t.search_action_tab_memory,
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
        ? t["palette.cmd.close_sessions"]
        : t["palette.cmd.open_sessions"],
      keywords: ["history", "replay"],
      hint: shortcutHint("toggleSessionsOverlay", isMac),
      perform: () => useCanvasStore.getState().toggleSessionsOverlay(),
    },
    {
      id: "open-snapshot-history",
      section: "action",
      title: t["palette.cmd.snapshot_history"],
      subtitle: t["palette.cmd.snapshot_history_subtitle"],
      keywords: [
        "time travel",
        "undo",
        "restore",
        "rollback",
        "checkpoint",
        "version",
      ],
      hint: shortcutHint("toggleSnapshotHistory", isMac),
      perform: () => useSnapshotHistoryStore.getState().openHistory(),
    },
    {
      id: "open-snapshot-diff",
      section: "action",
      title: t["palette.cmd.snapshot_diff"],
      subtitle: t["palette.cmd.snapshot_diff_subtitle"],
      keywords: [
        "compare",
        "changed",
        "delta",
        "what changed",
        "history",
        "snapshot",
      ],
      perform: () =>
        useSnapshotHistoryStore.getState().openHistoryInDiffMode(),
    },
    {
      id: "toggle-usage-overlay",
      section: "action",
      title: canvas.usageOverlayOpen
        ? t["palette.cmd.close_usage"]
        : t["palette.cmd.open_usage"],
      keywords: ["cost", "tokens", "consumption"],
      hint: shortcutHint("toggleUsageOverlay", isMac),
      perform: () => useCanvasStore.getState().toggleUsageOverlay(),
    },
    {
      id: "toggle-global-search",
      section: "action",
      title: prefs.globalSearchEnabled
        ? t["palette.cmd.disable_global_search"]
        : t["palette.cmd.enable_global_search"],
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
      title: prefs.composerEnabled
        ? t["palette.cmd.disable_composer"]
        : t["palette.cmd.enable_composer"],
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
        ? t["palette.cmd.disable_drawing"]
        : t["palette.cmd.enable_drawing"],
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
        ? t["palette.cmd.disable_completion_glow"]
        : t["palette.cmd.enable_completion_glow"],
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
      title: t["palette.cmd.toggle_activity_heatmap"],
      subtitle: prefs.activityHeatmapEnabled
        ? t["palette.cmd.activity_heatmap_subtitle_on"]
        : t["palette.cmd.activity_heatmap_subtitle_off"],
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
      title: prefs.petEnabled
        ? t["palette.cmd.disable_pet"]
        : t["palette.cmd.enable_pet"],
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
      title: t["palette.cmd.add_browser"],
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
      title: t["palette.cmd.refresh_terminal_rendering"],
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
        title: t["palette.cmd.star_focused"],
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
        title: t["palette.cmd.stash_focused"],
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

function canvasCommands(ctx: CommandContext): PaletteCommand[] {
  const { isMac } = ctx;
  const { canvases, activeCanvasId } = useCanvasRegistryStore.getState();
  const list: PaletteCommand[] = [];

  list.push({
    id: "canvas:new",
    section: "canvas",
    title: ctx.t["canvas.command.new"],
    keywords: ["canvas", "workspace", "create", "add", "new"],
    hint: shortcutHint("openCanvasManager", isMac),
    perform: () => {
      useCanvasRegistryStore.getState().createCanvas();
    },
  });

  list.push({
    id: "canvas:manage",
    section: "canvas",
    title: ctx.t["canvas.command.manage"],
    keywords: ["canvas", "workspace", "rename", "delete", "manage"],
    hint: shortcutHint("openCanvasManager", isMac),
    perform: () => {
      useCanvasManagerStore.getState().openManager();
    },
  });

  if (canvases.length > 1) {
    list.push(
      {
        id: "canvas:next",
        section: "canvas",
        title: ctx.t["canvas.command.next"],
        keywords: ["canvas", "workspace", "switch", "next"],
        hint: shortcutHint("nextCanvas", isMac),
        perform: () => useCanvasRegistryStore.getState().cycleCanvas(1),
      },
      {
        id: "canvas:prev",
        section: "canvas",
        title: ctx.t["canvas.command.prev"],
        keywords: ["canvas", "workspace", "switch", "previous"],
        hint: shortcutHint("prevCanvas", isMac),
        perform: () => useCanvasRegistryStore.getState().cycleCanvas(-1),
      },
    );
  }

  for (const canvas of canvases) {
    if (canvas.id === activeCanvasId) continue;
    list.push({
      id: `canvas:switch:${canvas.id}`,
      section: "canvas",
      title: ctx.t["canvas.command.switchTo"](canvas.name),
      subtitle: ctx.t["canvas.command.switchSubtitle"](
        canvas.scene.projects.length,
      ),
      keywords: ["canvas", "switch", canvas.name],
      perform: () =>
        useCanvasRegistryStore.getState().switchCanvas(canvas.id),
    });
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

function waypointCommands(ctx: CommandContext): PaletteCommand[] {
  const { t } = ctx;
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
        title: t["palette.cmd.jump_waypoint"](slot),
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
      title: t["palette.cmd.save_waypoint"](slot),
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
    ...canvasCommands(ctx),
    ...terminalCommands(),
    ...projectCommands(),
    ...waypointCommands(ctx),
  ];
}

export const SECTION_ORDER: CommandSection[] = [
  "action",
  "canvas",
  "terminal",
  "project",
  "waypoint",
];

export const SECTION_LABEL_KEYS: Record<
  CommandSection,
  | "palette.section.action"
  | "palette.section.canvas"
  | "palette.section.terminal"
  | "palette.section.project"
  | "palette.section.waypoint"
> = {
  action: "palette.section.action",
  canvas: "palette.section.canvas",
  terminal: "palette.section.terminal",
  project: "palette.section.project",
  waypoint: "palette.section.waypoint",
};

export const SECTION_GLYPH: Record<CommandSection, string> = {
  action: "A",
  canvas: "C",
  terminal: "T",
  project: "P",
  waypoint: "W",
};
