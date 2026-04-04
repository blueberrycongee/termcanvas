import { init } from "./ascii-logo.js";

const container = document.getElementById("ascii-logo");
if (container) init(container);

const zh = {
  tagline: "你的终端，铺在无限画布上。",
  download: "下载",
  features: "功能特性",
  "f1-title": "无限画布",
  "f1-desc": "自由平移、缩放、排列终端。告别标签页和分屏。",
  "f2-title": "AI Agent",
  "f2-desc": "Claude Code、Codex、Gemini、Kimi、OpenCode 并行运行，状态一目了然。",
  "f3-title": "Composer",
  "f3-desc": "统一输入栏，向聚焦的 agent 发送提示，支持粘贴图片。",
  "f4-title": "用量追踪",
  "f4-desc": "Token 成本看板，按项目和模型细分。清楚你的开销。",
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
