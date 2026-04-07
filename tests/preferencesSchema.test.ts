import test from "node:test";
import assert from "node:assert/strict";
import {
  preferencesSchema,
  cliCommandSchema,
  agentConfigSchema,
  TERMINAL_TYPES,
} from "../src/stores/preferencesSchema.ts";

test("preferencesSchema parse empty object returns all defaults", () => {
  const result = preferencesSchema.parse({});
  assert.equal(result.animationBlur, 0);
  assert.equal(result.terminalFontSize, 13);
  assert.equal(result.terminalFontFamily, "geist-mono");
  assert.equal(result.composerEnabled, false);
  assert.equal(result.drawingEnabled, false);
  assert.equal(result.browserEnabled, false);
  assert.equal(result.summaryEnabled, false);
  assert.equal(result.summaryCli, "claude");
  assert.equal(result.minimumContrastRatio, 1);
  assert.deepEqual(result.cliCommands, {});
  assert.equal(result.agentConfig.id, "anthropic");
  assert.equal(result.agentConfig.type, "anthropic");
});

test("preferencesSchema accepts valid input", () => {
  const result = preferencesSchema.parse({
    animationBlur: 1.5,
    terminalFontSize: 16,
    terminalFontFamily: "fira-code",
    composerEnabled: true,
    minimumContrastRatio: 3,
  });
  assert.equal(result.animationBlur, 1.5);
  assert.equal(result.terminalFontSize, 16);
  assert.equal(result.terminalFontFamily, "fira-code");
  assert.equal(result.composerEnabled, true);
  assert.equal(result.minimumContrastRatio, 3);
});

test("preferencesSchema clamps out-of-range fontSize", () => {
  const tooSmall = preferencesSchema.safeParse({ terminalFontSize: 3 });
  assert.equal(tooSmall.success, false);

  const tooBig = preferencesSchema.safeParse({ terminalFontSize: 30 });
  assert.equal(tooBig.success, false);
});

test("preferencesSchema rejects invalid summaryCli", () => {
  const result = preferencesSchema.safeParse({ summaryCli: "invalid" });
  assert.equal(result.success, false);
});

test("preferencesSchema animationBlur converts legacy true → 1.5", () => {
  const result = preferencesSchema.parse({ animationBlur: true });
  assert.equal(result.animationBlur, 1.5);
});

test("preferencesSchema animationBlur converts legacy false → 0", () => {
  const result = preferencesSchema.parse({ animationBlur: false });
  assert.equal(result.animationBlur, 0);
});

test("cliCommandSchema accepts valid command", () => {
  const result = cliCommandSchema.parse({ command: "node", args: ["-e", "42"] });
  assert.equal(result.command, "node");
  assert.deepEqual(result.args, ["-e", "42"]);
});

test("cliCommandSchema rejects empty command", () => {
  const result = cliCommandSchema.safeParse({ command: "" });
  assert.equal(result.success, false);
});

test("cliCommandSchema defaults args to empty array", () => {
  const result = cliCommandSchema.parse({ command: "bash" });
  assert.deepEqual(result.args, []);
});

test("agentConfigSchema accepts valid config", () => {
  const result = agentConfigSchema.parse({
    id: "openai-custom",
    name: "OpenAI",
    type: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4",
  });
  assert.equal(result.type, "openai");
  assert.equal(result.model, "gpt-4");
});

test("agentConfigSchema fills defaults for empty input", () => {
  const result = agentConfigSchema.parse({});
  assert.equal(result.id, "anthropic");
  assert.equal(result.name, "Anthropic");
  assert.equal(result.type, "anthropic");
  assert.equal(result.baseURL, "");
  assert.equal(result.apiKey, "");
  assert.equal(result.model, "");
});

test("agentConfigSchema rejects invalid type", () => {
  const result = agentConfigSchema.safeParse({ type: "google" });
  assert.equal(result.success, false);
});

test("TERMINAL_TYPES includes expected types", () => {
  assert.ok(TERMINAL_TYPES.includes("shell"));
  assert.ok(TERMINAL_TYPES.includes("claude"));
  assert.ok(TERMINAL_TYPES.includes("codex"));
  assert.ok(TERMINAL_TYPES.includes("lazygit"));
});

test("preferencesSchema field-by-field safeParse preserves valid partial data", () => {
  const raw = {
    terminalFontSize: 18,
    terminalFontFamily: "invalid-value-passing-through",
    composerEnabled: true,
    animationBlur: "not-a-number",
  };

  const defaults = preferencesSchema.parse({});
  const result: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(
    preferencesSchema.shape as Record<string, import("zod").ZodTypeAny>,
  )) {
    const fieldValue = (raw as Record<string, unknown>)[key];
    if (fieldValue === undefined) {
      result[key] = defaults[key as keyof typeof defaults];
      continue;
    }
    const fieldResult = (fieldSchema as import("zod").ZodTypeAny).safeParse(fieldValue);
    result[key] = fieldResult.success
      ? fieldResult.data
      : defaults[key as keyof typeof defaults];
  }

  assert.equal(result.terminalFontSize, 18);
  assert.equal(result.composerEnabled, true);
  // animationBlur was invalid → falls back to default
  assert.equal(result.animationBlur, 0);
});
