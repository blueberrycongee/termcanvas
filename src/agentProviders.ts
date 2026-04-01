/**
 * Agent provider presets and configuration types.
 *
 * ProviderType ("anthropic" | "openai") determines which SDK path to use.
 * Each preset carries a default baseURL and recommended model so users
 * only need to paste an API key to get started.
 */

export type ProviderType = "anthropic" | "openai";

export interface AgentProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  defaultModel: string;
  keyPlaceholder: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseURL: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    keyPlaceholder: "sk-...",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    keyPlaceholder: "sk-...",
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    type: "openai",
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-auto",
    keyPlaceholder: "sk-...",
  },
  {
    id: "zhipu",
    name: "Zhipu (GLM)",
    type: "openai",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    keyPlaceholder: "...",
  },
  {
    id: "minimax",
    name: "Minimax",
    type: "openai",
    baseURL: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    keyPlaceholder: "...",
  },
  {
    id: "qwen",
    name: "Qwen (DashScope)",
    type: "openai",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    keyPlaceholder: "sk-...",
  },
  {
    id: "google",
    name: "Google Gemini",
    type: "openai",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-pro",
    keyPlaceholder: "AI...",
  },
  {
    id: "custom",
    name: "Custom",
    type: "openai",
    baseURL: "",
    defaultModel: "",
    keyPlaceholder: "...",
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function defaultProviderConfig(): AgentProviderConfig {
  const preset = PROVIDER_PRESETS[0];
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    baseURL: preset.baseURL,
    apiKey: "",
    model: preset.defaultModel,
  };
}
