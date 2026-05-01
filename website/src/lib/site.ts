export const locales = ["zh", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh";

export const localeLabels: Record<Locale, string> = {
  zh: "中文",
  en: "English",
};

export const localeHtmlLang: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en",
};

export const dateLocales: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en-US",
};

export const siteCopy = {
  zh: {
    name: "TermCanvas",
    defaultDescription:
      "TermCanvas 是为 AI 编码 agent 设计的无限画布终端工作台，把终端、worktree、会话和 Hydra 编排放在同一张可视化画布上。",
    homeTitle: "TermCanvas — AI 编码 agent 的无限画布终端",
    articlesTitle: "文章 · TermCanvas",
    articlesDescription:
      "TermCanvas 团队关于终端、AI agent、harness 设计与 Hydra 编排的长文与技术报告。",
    nav: {
      articles: "文章",
      download: "下载",
      github: "GitHub",
    },
    footer: {
      tagline: "把所有终端铺到一张无限画布上。",
      project: "项目",
      repository: "GitHub 仓库",
      releases: "下载与发布",
      issues: "问题反馈",
      reading: "阅读",
      articles: "文章列表",
      readme: "README",
    },
    hero: {
      eyebrow: "v0.39 · 开源 · macOS / Windows / Linux",
      title: "把所有终端铺到一张无限画布上。",
      tagline:
        "TermCanvas 是一个为 AI 编码 agent 时代而设计的终端工作台。空间化布局取代 tab 与分屏，让 Claude Code、Codex、Gemini 等多个 agent 能并行工作、互相对照，全程在一张画布里被你看见。",
      download: "下载 TermCanvas",
      github: "查看 GitHub",
      meta: "MIT License · 完全开源 · 不收集任何用户数据",
      imageAlt: "TermCanvas 多个 AI agent 在无限画布上协作",
    },
    features: {
      eyebrow: "特性",
      title: "不是另一个终端，是终端的下一种形态。",
      items: [
        {
          label: "01",
          title: "无限空间画布",
          body: "用 pan / zoom / 拖拽组织所有终端会话。Tab 和 split pane 不再是必要，把上下文铺开，靠空间记忆而不是窗口管理来导航。",
        },
        {
          label: "02",
          title: "AI agent 第一公民",
          body: "Claude Code、Codex、Gemini、Kimi、OpenCode 都能在同一张画布并行运行。每个 agent 有独立终端、独立 worktree、可视的状态徽标。",
        },
        {
          label: "03",
          title: "Hydra 编排系统",
          body: "Lead-driven decider 模式：你在结构化决策点做判断，Hydra 处理 dispatch / watch / merge 的运维，专为 LLM 决策者特化。",
        },
        {
          label: "04",
          title: "Composer 统一输入",
          body: "一条命令栏把 prompt 发给当前 focus 的 agent，支持图片粘贴、上下文引用。不必在多个终端之间反复切焦点。",
        },
      ],
      hubEyebrow: "Hub 视图",
      hubBody:
        "所有会话以知识图谱方式呈现，支持跨会话引用、检索、归档。长期项目的上下文不再丢失在终端历史里。",
      hubAlt: "TermCanvas Hub 知识图谱视图与会话侧栏",
    },
    articles: {
      eyebrow: "文章",
      title: "设计哲学，工程实录，思考片段。",
      lede: "这里收录 TermCanvas 团队对终端、AI agent、harness 设计的长文。我们更关心为什么这样设计，而不是只记录代码怎么写。",
      viewAll: "查看全部",
      empty: "还没有文章。",
      back: "全部文章",
      readMore: "阅读全文",
    },
  },
  en: {
    name: "TermCanvas",
    defaultDescription:
      "TermCanvas is an infinite-canvas terminal workspace for AI coding agents, built to manage terminals, worktrees, sessions, and Hydra orchestration visually.",
    homeTitle: "TermCanvas — Infinite canvas terminal for AI coding agents",
    articlesTitle: "Articles · TermCanvas",
    articlesDescription:
      "Long-form notes from TermCanvas on AI coding agents, terminal workspaces, harness design, and Hydra orchestration.",
    nav: {
      articles: "Articles",
      download: "Download",
      github: "GitHub",
    },
    footer: {
      tagline: "An infinite canvas for every terminal and coding agent.",
      project: "Project",
      repository: "GitHub repository",
      releases: "Downloads and releases",
      issues: "Issues",
      reading: "Reading",
      articles: "Article index",
      readme: "README",
    },
    hero: {
      eyebrow: "v0.39 · Open source · macOS / Windows / Linux",
      title: "An infinite canvas terminal for AI coding agents.",
      tagline:
        "TermCanvas is a visual terminal workspace built for parallel AI coding agents. Replace crowded tabs and split panes with a spatial canvas where Claude Code, Codex, Gemini, and other agents can run side by side with visible context.",
      download: "Download TermCanvas",
      github: "View on GitHub",
      meta: "MIT License · Open source · No user data collection",
      imageAlt: "TermCanvas showing multiple AI coding agents on an infinite canvas",
    },
    features: {
      eyebrow: "Features",
      title: "Not another terminal. A workspace for agentic development.",
      items: [
        {
          label: "01",
          title: "Spatial terminal canvas",
          body: "Organize terminal sessions with pan, zoom, and drag. Keep context visible and navigable through spatial memory instead of tab archaeology.",
        },
        {
          label: "02",
          title: "Built for AI coding agents",
          body: "Run Claude Code, Codex, Gemini, Kimi, and OpenCode side by side. Each agent can have its own terminal, worktree, and visible status.",
        },
        {
          label: "03",
          title: "Hydra orchestration",
          body: "A lead-driven decider workflow for dispatch, watch, and merge loops. Hydra keeps long-running agent work structured without hiding decisions.",
        },
        {
          label: "04",
          title: "Unified composer",
          body: "Send prompts to the focused agent from one input surface, with image paste and context references when the task needs them.",
        },
      ],
      hubEyebrow: "Hub view",
      hubBody:
        "Sessions can be reviewed as a knowledge graph, with cross-session references, search, and archival context for long-running projects.",
      hubAlt: "TermCanvas Hub view with a knowledge graph and session sidebar",
    },
    articles: {
      eyebrow: "Articles",
      title: "Design notes, engineering logs, and field reports.",
      lede: "Long-form writing on terminal workspaces, AI coding agents, harness design, and the engineering choices behind TermCanvas.",
      viewAll: "View all",
      empty: "No articles yet.",
      back: "All articles",
      readMore: "Read article",
    },
  },
} as const;

export function isLocale(value: string | undefined): value is Locale {
  return value === "zh" || value === "en";
}

export function withLocale(locale: Locale, path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalized === "/" ? "/" : normalized}`;
}

export function articlesPath(locale: Locale): string {
  return withLocale(locale, "/articles/");
}

export function articleSlugForLocale(entryId: string, locale: Locale): string {
  const prefix = `${locale}/`;
  return entryId.startsWith(prefix) ? entryId.slice(prefix.length) : entryId;
}

export function articlePath(locale: Locale, entryId: string): string {
  return withLocale(locale, `/articles/${articleSlugForLocale(entryId, locale)}/`);
}

export function absoluteUrl(site: URL, path: string): string {
  return new URL(path, site).toString();
}
