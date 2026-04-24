export interface HealthResponse {
  ok: boolean;
  version: string;
}

export interface StatusResponse {
  accessibility_granted: boolean;
  screen_recording_granted: boolean;
}

export interface ComputerUseStatus {
  healthy: boolean;
  accessibility_granted: boolean;
  screen_recording_granted: boolean;
}

export interface AppInfo {
  name: string;
  bundle_id: string;
  pid: number;
  is_frontmost: boolean;
}

export interface OpenAppParams {
  bundle_id?: string;
  name?: string;
}

export interface OpenAppResponse {
  ok: boolean;
  pid?: number;
}

export interface GetAppStateParams {
  pid: number;
  include_screenshot?: boolean;
  max_depth?: number;
}

export interface AppState {
  app: Record<string, unknown>;
  windows: Record<string, unknown>[];
  elements: Record<string, unknown>[];
  screenshot_path?: string;
  coordinate_space?: string;
  [key: string]: unknown;
}

export interface ClickParams {
  element_id?: string;
  pid?: number;
  x?: number;
  y?: number;
  coordinate_space?: string;
  button?: "left" | "right" | "double";
}

export interface TypeTextParams {
  text: string;
}

export interface PressKeyParams {
  key: string;
  modifiers?: string[];
}

export interface ScrollParams {
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  element_id?: string;
  pid?: number;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
}

export interface DragParams {
  from_x?: number;
  from_y?: number;
  to_x?: number;
  to_y?: number;
  from_element_id?: string;
  to_element_id?: string;
  pid?: number;
}

export interface OkResponse {
  ok: boolean;
  error?: string;
}
