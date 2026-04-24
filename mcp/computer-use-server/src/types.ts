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
  pid?: number;
  app_name?: string;
  include_screenshot?: boolean;
  max_depth?: number;
}

export interface AppState {
  app: Record<string, unknown>;
  windows: Record<string, unknown>[];
  elements: Record<string, unknown>[];
  accessibility_tree?: Record<string, unknown>[];
  screenshot_path?: string;
  screenshot?: Record<string, unknown>;
  screenshot_pixel_size?: Record<string, unknown>;
  screenshot_scale?: number;
  window_frame?: Record<string, unknown>;
  coordinate_space?: string;
  [key: string]: unknown;
}

export interface ClickParams {
  element_id?: string;
  element?: number;
  pid?: number;
  app_name?: string;
  x?: number;
  y?: number;
  coordinate_space?: string;
  button?: "left" | "right" | "double";
  mouse_button?: "left" | "right" | "double";
  click_count?: number;
}

export interface TypeTextParams {
  text: string;
}

export interface PressKeyParams {
  key: string;
  modifiers?: string[];
}

export interface SetValueParams {
  element_id?: string;
  element?: number;
  pid?: number;
  app_name?: string;
  value: string;
}

export interface PerformSecondaryActionParams {
  element_id?: string;
  element?: number;
  pid?: number;
  app_name?: string;
  action: string;
}

export interface ScrollParams {
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  element_id?: string;
  element?: number;
  pid?: number;
  app_name?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  coordinate_space?: string;
}

export interface DragParams {
  from_x?: number;
  from_y?: number;
  to_x?: number;
  to_y?: number;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  from_element_id?: string;
  to_element_id?: string;
  from_element?: number;
  to_element?: number;
  pid?: number;
  app_name?: string;
  coordinate_space?: string;
}

export interface OkResponse {
  ok: boolean;
  error?: string;
}
