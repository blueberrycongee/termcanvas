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

export interface WindowInfo {
  window_id: number;
  pid: number;
  app_name: string;
  title: string;
  bounds: Record<string, unknown>;
  layer: number;
  z_index: number;
  is_on_screen: boolean;
  on_current_space?: boolean;
  space_ids?: number[];
}

export interface ListWindowsParams {
  pid?: number;
  on_screen_only?: boolean;
}

export interface ListWindowsResponse {
  windows: WindowInfo[];
  current_space_id?: number | null;
}

export interface ScreenSizeResponse {
  width: number;
  height: number;
  scale: number;
}

export interface ScreenshotInfo {
  capture_id: string;
  path: string;
  pixel_size: Record<string, unknown>;
  scale: number;
  window_frame?: Record<string, unknown>;
  coordinate_space: string;
  capture_backend?: string;
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
  capture_mode?: string;
  max_image_dimension?: number;
}

export interface GetWindowStateParams {
  pid: number;
  window_id: number;
  include_screenshot?: boolean;
  max_depth?: number;
  capture_mode?: string;
  max_image_dimension?: number;
}

export interface ScreenshotParams {
  pid?: number;
  window_id?: number;
}

export interface ZoomParams {
  pid: number;
  capture_id?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AppState {
  app: Record<string, unknown>;
  windows: Record<string, unknown>[];
  current_space_id?: number | null;
  elements: Record<string, unknown>[];
  accessibility_tree?: Record<string, unknown>[];
  screenshot_path?: string;
  screenshot?: Record<string, unknown>;
  screenshot_capture_id?: string;
  screenshot_pixel_size?: Record<string, unknown>;
  screenshot_scale?: number;
  window_frame?: Record<string, unknown>;
  coordinate_space?: string;
  [key: string]: unknown;
}

export interface ClickParams {
  element_id?: string;
  element?: number;
  element_index?: number;
  window_id?: number;
  pid?: number;
  app_name?: string;
  x?: number;
  y?: number;
  capture_id?: string;
  coordinate_space?: string;
  button?: "left" | "right" | "middle" | "double";
  mouse_button?: "left" | "right" | "middle" | "double";
  click_count?: number;
  modifiers?: string[];
  modifier?: string[];
  from_zoom?: boolean;
  debug_image_out?: string;
  max_image_dimension?: number;
}

export interface TypeTextParams {
  text: string;
  pid?: number;
  window_id?: number;
  element_index?: number;
}

export interface PressKeyParams {
  key: string;
  modifiers?: string[];
  pid?: number;
  window_id?: number;
  element_index?: number;
}

export interface SetValueParams {
  element_id?: string;
  element?: number;
  element_index?: number;
  window_id?: number;
  pid?: number;
  app_name?: string;
  value: string;
}

export interface PerformSecondaryActionParams {
  element_id?: string;
  element?: number;
  element_index?: number;
  window_id?: number;
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
  element_index?: number;
  window_id?: number;
  pid?: number;
  app_name?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  capture_id?: string;
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
  from_element_index?: number;
  to_element_index?: number;
  window_id?: number;
  pid?: number;
  app_name?: string;
  capture_id?: string;
  coordinate_space?: string;
}

export interface OkResponse {
  ok: boolean;
  error?: string;
}
