import { init } from "./ascii-logo.js";

const container = document.getElementById("ascii-logo");
if (container) init(container);

// ── i18n ────────────────────────────────────────────────────────
const zh = {
  // Nav
  "nav-features": "功能",
  "nav-screenshots": "截图",
  "nav-demo": "演示",
  "nav-docs": "文档",

  // Hero
  tagline: "你的终端，铺在无限画布上。",
  download: "下载",

  // Features
  features: "功能特性",
  "f1-title": "无限画布",
  "f1-desc": "自由平移、缩放、排列终端。告别标签页和分屏。",
  "f2-title": "AI Agent",
  "f2-desc": "Claude Code、Codex、Gemini、Kimi、OpenCode 并行运行，状态一目了然。",
  "f3-title": "Composer",
  "f3-desc": "统一输入栏，向聚焦的 agent 发送提示，支持粘贴图片。",
  "f4-title": "用量追踪",
  "f4-desc": "Token 成本看板，按项目和模型细分。清楚你的开销。",

  // Screenshots
  "screenshots-title": "截图",
  "ss-canvas": "终端在无限画布上自由排列",
  "ss-agents": "AI Agent 并行运行，实时状态显示",
  "ss-composer": "Composer 发送提示，支持粘贴图片",
  "ss-usage": "用量看板，按模型细分成本",
  "ss-drawing": "画布上自由绘制和标注",
  "ss-hydra": "Hydra 编排并行 Agent 任务",

  // Demo
  "demo-title": "演示",
  "demo-subtitle": "观看 TermCanvas 的实际操作 — 从画布导航到多 Agent 工作流。",
  "demo-placeholder": "演示视频即将推出",

  // Docs
  "docs-title": "文档",
  "docs-nav-gs": "快速开始",
  "docs-nav-concepts": "核心概念",
  "docs-nav-shortcuts": "快捷键",
  "docs-nav-config": "配置",

  // Docs — Getting Started
  "docs-gs-title": "快速开始",
  "docs-gs-install-title": "安装",
  "docs-gs-install-desc": "从 GitHub Releases 下载适合你平台的最新版本。TermCanvas 支持 macOS、Linux 和 Windows。",
  "docs-gs-cli-title": "CLI 设置",
  "docs-gs-cli-desc": "启动应用后，进入 设置 → 通用 → 命令行工具，点击注册。这会将 termcanvas 和 hydra 添加到你的 PATH。",
  "docs-gs-first-title": "第一步",
  "docs-gs-step1": "打开 TermCanvas，按 ⌘ O 添加项目（或 文件 → 添加项目）",
  "docs-gs-step2": "TermCanvas 自动检测项目中的 git worktree",
  "docs-gs-step3": "按 ⌘ T 创建新终端 — 选择 shell、lazygit 或 AI Agent",
  "docs-gs-step4": "在画布上拖动终端，滚轮缩放，双击标题栏自动适配大小",

  // Docs — Key Concepts
  "docs-concepts-title": "核心概念",
  "docs-concept-canvas-title": "画布",
  "docs-concept-canvas-desc": "无限 2D 工作区，所有终端都在这里。拖动背景平移，滚轮或捏合缩放。从空白处拖动可框选多个终端。使用绘图工具进行标注。",
  "docs-concept-hierarchy-title": "项目 → Worktree → 终端",
  "docs-concept-hierarchy-desc": "TermCanvas 采用三层层级结构，与 git 使用方式一致。添加项目后，worktree 自动出现。每个 worktree 可包含多个终端。",
  "docs-concept-agents-title": "AI Agent",
  "docs-concept-agents-desc": "原生支持 Claude Code、Codex、Gemini、Kimi 和 OpenCode。每个 Agent 有独立终端，实时状态指示（工作中、等待中、完成），会话跨重启保持。",
  "docs-concept-composer-title": "Composer",
  "docs-concept-composer-desc": "屏幕底部的统一输入栏，向当前聚焦的 Agent 终端发送提示。支持直接粘贴图片。",
  "docs-concept-hydra-title": "Hydra",
  "docs-concept-hydra-desc": "任务编排工具，将大任务拆分为子任务，每个子任务在独立的 git worktree 中运行专属 AI Agent。在项目中运行 hydra init，然后让 Agent 使用 Hydra。",

  // Docs — Shortcuts
  "docs-shortcuts-title": "快捷键",
  "docs-shortcuts-note": "所有快捷键可在 设置 → 快捷键 中自定义。Windows/Linux 上将 ⌘ 替换为 Ctrl。",
  "docs-shortcuts-col-key": "快捷键",
  "docs-shortcuts-col-action": "操作",
  "sc-add-project": "添加项目",
  "sc-sidebar": "切换侧边栏",
  "sc-panel": "切换右侧面板（用量）",
  "sc-new-term": "新建终端",
  "sc-close-term": "关闭当前终端",
  "sc-rename": "重命名终端标题",
  "sc-next": "下一个终端",
  "sc-prev": "上一个终端",
  "sc-unfocus": "取消聚焦 / 重新聚焦",
  "sc-star": "收藏 / 取消收藏终端",
  "sc-star-next": "下一个收藏终端",
  "sc-star-prev": "上一个收藏终端",
  "sc-save": "保存工作区",
  "sc-save-as": "另存为工作区",
  "sc-sizes": "终端尺寸预设",

  // Docs — Configuration
  "docs-config-title": "配置",
  "docs-config-fonts-title": "字体",
  "docs-config-fonts-desc": "设置中提供 6 种可下载等宽字体，每种字体都针对终端渲染优化。",
  "docs-config-theme-title": "主题",
  "docs-config-theme-desc": "深色和浅色主题，支持最低对比度设置以增强可访问性。主题应用于画布、终端和所有 UI 元素。",
  "docs-config-lang-title": "语言",
  "docs-config-lang-desc": "支持英文和中文。应用首次启动时自动检测系统语言，可随时在设置中更改。",
  "docs-config-updates-title": "更新",
  "docs-config-updates-desc": "默认启用自动更新。新版本在后台下载，重启时应用。应用内变更日志显示每个版本的更新内容。",
  "docs-config-agent-title": "Agent CLI 覆盖",
  "docs-config-agent-desc": "每种 AI Agent 类型可在设置中配置自定义 CLI 路径，支持使用特定版本或自定义封装。",

  // CTA
  "cta-sub": "MIT 许可 \u00b7 开源",
};

const en = {};
document.querySelectorAll("[data-i18n]").forEach((el) => {
  en[el.dataset.i18n] = el.textContent;
});

function applyLang(lang) {
  const strings = lang === "zh" ? zh : en;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (strings[key]) el.textContent = strings[key];
  });
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}

let currentLang = "en";
const btn = document.getElementById("lang-toggle");
if (btn) {
  btn.addEventListener("click", () => {
    currentLang = currentLang === "en" ? "zh" : "en";
    btn.textContent = currentLang === "en" ? "中文" : "EN";
    applyLang(currentLang);
    localStorage.setItem("lang", currentLang);
  });

  const saved = localStorage.getItem("lang");
  if (saved === "zh") {
    currentLang = "zh";
    btn.textContent = "EN";
    applyLang("zh");
  }
}
