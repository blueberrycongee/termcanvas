import fs from "fs";
import path from "path";
import { TERMCANVAS_DIR } from "./state-persistence";
import type {
  InsightsAtAGlanceSection,
  InsightsFrictionSection,
  InsightsInteractionStyleSection,
  InsightsOnTheHorizonSection,
  InsightsProjectAreasSection,
  InsightsResult,
  InsightsSuggestionsSection,
  InsightsWhatWorksSection,
} from "./insights-shared";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatLabel(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function topEntries(data: Record<string, number>, limit = 6): Array<[string, number]> {
  return Object.entries(data)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function stackedBars(
  title: string,
  data: Record<string, number>,
  tone: string,
  limit = 6,
): string {
  const entries = topEntries(data, limit);
  const maxValue = Math.max(...entries.map(([, value]) => value), 0);
  if (maxValue === 0) return "";

  const rows = entries
    .map(([label, value]) => {
      const width = Math.max(8, Math.round((value / maxValue) * 100));
      return `<div class="metric-row">
        <div class="metric-label">${escapeHtml(formatLabel(label))}</div>
        <div class="metric-track">
          <div class="metric-fill ${tone}" style="width:${width}%"></div>
        </div>
        <div class="metric-value">${formatNumber(value)}</div>
      </div>`;
    })
    .join("");

  return `<section class="panel">
    <div class="panel-kicker">Distribution</div>
    <h2>${escapeHtml(title)}</h2>
    <div class="metric-list">${rows}</div>
  </section>`;
}

function heatmap(data: Record<string, number>): string {
  const values = Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, "0");
    return { key, value: data[key] ?? 0 };
  });
  const maxValue = Math.max(...values.map((entry) => entry.value), 0);
  if (maxValue === 0) return "";

  const cells = values
    .map(({ key, value }) => {
      const intensity = value === 0 ? 0 : Math.max(0.16, value / maxValue);
      return `<div class="heat-cell" title="${escapeHtml(`${key}:00 - ${value} messages`)}">
        <span class="heat-cell-fill" style="opacity:${intensity}"></span>
        <span class="heat-hour">${key}</span>
      </div>`;
    })
    .join("");

  return `<section class="panel">
    <div class="panel-kicker">Rhythm</div>
    <h2>Time Of Day</h2>
    <p class="panel-copy">When messages cluster during the day. Useful for spotting deep-work windows versus reactive cleanup time.</p>
    <div class="heat-grid">${cells}</div>
  </section>`;
}

function statCards(insights: InsightsResult): string {
  const { stats } = insights;
  const totalHours = (stats.totalDurationMinutes / 60).toFixed(1);
  const analysisCoverage =
    8 - Object.keys(insights.sectionErrors).length;

  const cards = [
    ["Sessions", formatNumber(stats.totalSessions)],
    ["Hours", `${totalHours}h`],
    ["Input Tokens", formatNumber(stats.totalInputTokens)],
    ["Output Tokens", formatNumber(stats.totalOutputTokens)],
    ["Lines Added", formatNumber(stats.totalLinesAdded)],
    ["Files Touched", formatNumber(stats.totalFilesModified)],
    ["Avg Assist Resp", `${stats.averageAssistantResponseSeconds}s`],
    ["Analysis Sections", `${analysisCoverage}/8`],
  ]
    .map(
      ([label, value]) => `<div class="stat-card">
        <div class="stat-value">${escapeHtml(value)}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
      </div>`,
    )
    .join("");

  return `<section class="stats-grid">${cards}</section>`;
}

function coveragePanel(insights: InsightsResult): string {
  const { stats } = insights;
  const failures = Object.entries(insights.sectionErrors);
  const issues =
    failures.length === 0
      ? `<p>No analysis sections failed. Cached facets: ${formatNumber(stats.cachedFacetSessions)}.</p>`
      : `<ul>${failures
          .map(
            ([key, error]) =>
              `<li><strong>${escapeHtml(formatLabel(key))}:</strong> ${escapeHtml(error ?? "Unknown error")}</li>`,
          )
          .join("")}</ul>`;

  return `<section class="panel notice-panel">
    <div class="panel-kicker">Coverage</div>
    <h2>What This Run Included</h2>
    <p class="panel-copy">This report analyzed ${formatNumber(stats.totalSessions)} sessions out of ${formatNumber(stats.totalEligibleSessions)} eligible ${escapeHtml(stats.sourceCli)} sessions. ${formatNumber(stats.failedFacetSessions)} facet extractions failed and ${formatNumber(stats.deferredFacetSessions)} sessions were deferred to keep a single run bounded.</p>
    ${issues}
  </section>`;
}

function atAGlance(section: InsightsAtAGlanceSection): string {
  return `<section class="hero-panel">
    <div class="hero-kicker">At A Glance</div>
    <h2>${escapeHtml(section.headline)}</h2>
    <ul class="hero-list">
      ${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
    </ul>
  </section>`;
}

function projectAreas(section: InsightsProjectAreasSection | null): string {
  if (!section) return "";
  return `<section class="panel">
    <div class="panel-kicker">What You Work On</div>
    <h2>Project Areas</h2>
    <p class="panel-copy">${escapeHtml(section.summary)}</p>
    <div class="card-grid">
      ${section.areas
        .map(
          (area) => `<article class="mini-card">
            <div class="mini-eyebrow">${escapeHtml(area.share)}</div>
            <h3>${escapeHtml(area.name)}</h3>
            <p>${escapeHtml(area.evidence)}</p>
            <div class="mini-footer">${escapeHtml(area.opportunities)}</div>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function interactionStyle(section: InsightsInteractionStyleSection | null): string {
  if (!section) return "";
  return `<section class="panel">
    <div class="panel-kicker">How You Collaborate</div>
    <h2>Interaction Style</h2>
    <p class="panel-copy">${escapeHtml(section.summary)}</p>
    <div class="stacked-cards">
      ${section.patterns
        .map(
          (pattern) => `<article class="detail-card">
            <h3>${escapeHtml(pattern.title)}</h3>
            <p><strong>Signal:</strong> ${escapeHtml(pattern.signal)}</p>
            <p><strong>Impact:</strong> ${escapeHtml(pattern.impact)}</p>
            <p><strong>Coaching:</strong> ${escapeHtml(pattern.coaching)}</p>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function whatWorks(section: InsightsWhatWorksSection | null): string {
  if (!section) return "";
  return `<section class="panel">
    <div class="panel-kicker">Strengths</div>
    <h2>What Works Well</h2>
    <p class="panel-copy">${escapeHtml(section.summary)}</p>
    <div class="stacked-cards">
      ${section.wins
        .map(
          (win) => `<article class="detail-card success-card">
            <h3>${escapeHtml(win.title)}</h3>
            <p><strong>Evidence:</strong> ${escapeHtml(win.evidence)}</p>
            <p><strong>Why It Works:</strong> ${escapeHtml(win.whyItWorks)}</p>
            <p><strong>Do More Of:</strong> ${escapeHtml(win.doMoreOf)}</p>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function frictionAnalysis(section: InsightsFrictionSection | null): string {
  if (!section) return "";
  return `<section class="panel">
    <div class="panel-kicker">Risks</div>
    <h2>Where The Workflow Slips</h2>
    <p class="panel-copy">${escapeHtml(section.summary)}</p>
    <div class="stacked-cards">
      ${section.issues
        .map(
          (issue) => `<article class="detail-card warning-card">
            <div class="severity-pill severity-${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)}</div>
            <h3>${escapeHtml(issue.title)}</h3>
            <p><strong>Evidence:</strong> ${escapeHtml(issue.evidence)}</p>
            <p><strong>Likely Cause:</strong> ${escapeHtml(issue.likelyCause)}</p>
            <p><strong>Mitigation:</strong> ${escapeHtml(issue.mitigation)}</p>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function suggestions(section: InsightsSuggestionsSection | null): string {
  if (!section) return "";
  return `<section class="panel">
    <div class="panel-kicker">Next Moves</div>
    <h2>Actionable Suggestions</h2>
    <p class="panel-copy">${escapeHtml(section.summary)}</p>
    <div class="stacked-cards">
      ${section.actions
        .map(
          (action, index) => `<article class="detail-card action-card">
            <div class="severity-pill severity-${escapeHtml(action.priority)}">${escapeHtml(action.priority)}</div>
            <h3>${escapeHtml(action.title)}</h3>
            <p><strong>Why:</strong> ${escapeHtml(action.rationale)}</p>
            <p><strong>Playbook:</strong> ${escapeHtml(action.playbook)}</p>
            <div class="copy-wrap">
              <pre class="copy-box" id="copy-${index}">${escapeHtml(action.copyablePrompt)}</pre>
              <button class="copy-button" data-copy-target="copy-${index}">Copy Prompt</button>
            </div>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function horizon(section: InsightsOnTheHorizonSection | null): string {
  if (!section) return "";
  return `<section class="panel">
    <div class="panel-kicker">Ahead</div>
    <h2>On The Horizon</h2>
    <p class="panel-copy">${escapeHtml(section.summary)}</p>
    <div class="stacked-cards">
      ${section.bets
        .map(
          (bet, index) => `<article class="detail-card horizon-card">
            <h3>${escapeHtml(bet.title)}</h3>
            <p><strong>Why Now:</strong> ${escapeHtml(bet.whyNow)}</p>
            <p><strong>Experiment:</strong> ${escapeHtml(bet.experiment)}</p>
            <div class="copy-wrap">
              <pre class="copy-box" id="horizon-${index}">${escapeHtml(bet.copyablePrompt)}</pre>
              <button class="copy-button" data-copy-target="horizon-${index}">Copy Experiment</button>
            </div>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
}

function funEnding(insights: InsightsResult): string {
  if (!insights.funEnding) return "";
  return `<section class="panel ending-panel">
    <div class="panel-kicker">Memorable Moment</div>
    <h2>${escapeHtml(insights.funEnding.title)}</h2>
    <blockquote>${escapeHtml(insights.funEnding.moment)}</blockquote>
    <p class="panel-copy">${escapeHtml(insights.funEnding.whyItMatters)}</p>
  </section>`;
}

export function generateReport(insights: InsightsResult): string {
  const reportsDir = path.join(TERMCANVAS_DIR, "insights-reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const { stats } = insights;
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TermCanvas Insights Report</title>
<style>
  :root {
    --bg: #101412;
    --panel: rgba(17, 27, 24, 0.88);
    --panel-alt: rgba(14, 21, 19, 0.96);
    --border: rgba(154, 191, 173, 0.18);
    --text: #edf4ee;
    --muted: #b9c9bc;
    --faint: #7f9487;
    --accent: #d3a86c;
    --accent-strong: #f0c58b;
    --mint: #63c7a6;
    --rose: #ff9472;
    --slate: #3c4d46;
    --good: #78d39f;
    --warn: #ffb16e;
    --bad: #ff8678;
    --shadow: 0 24px 80px rgba(0, 0, 0, 0.36);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(211, 168, 108, 0.18), transparent 28%),
      radial-gradient(circle at top right, rgba(99, 199, 166, 0.12), transparent 32%),
      linear-gradient(180deg, #0d100f 0%, var(--bg) 28%, #0a0d0c 100%);
    color: var(--text);
    font-family: "Avenir Next", "Segoe UI", sans-serif;
    line-height: 1.6;
  }
  .wrap {
    width: min(1180px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 32px 0 64px;
  }
  .masthead {
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, rgba(19, 31, 27, 0.94), rgba(10, 15, 13, 0.94));
    border: 1px solid var(--border);
    border-radius: 28px;
    padding: 32px;
    box-shadow: var(--shadow);
    margin-bottom: 24px;
  }
  .masthead::after {
    content: "";
    position: absolute;
    inset: auto -80px -90px auto;
    width: 280px;
    height: 280px;
    background: radial-gradient(circle, rgba(211, 168, 108, 0.22), transparent 65%);
    pointer-events: none;
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--accent-strong);
    letter-spacing: 0.16em;
    font-size: 12px;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .masthead h1 {
    margin: 0;
    font-family: "Iowan Old Style", "Palatino Linotype", serif;
    font-size: clamp(32px, 6vw, 56px);
    line-height: 1.02;
    max-width: 12ch;
  }
  .masthead p {
    max-width: 760px;
    color: var(--muted);
    margin: 14px 0 0;
  }
  .meta-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 20px;
  }
  .meta-pill {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 8px 12px;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.02);
    font-size: 13px;
  }
  .stats-grid, .two-col, .three-col, .card-grid, .stacked-cards {
    display: grid;
    gap: 16px;
  }
  .stats-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 24px;
  }
  .two-col {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: 24px;
  }
  .three-col {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-bottom: 24px;
  }
  .stat-card, .panel, .hero-panel {
    border: 1px solid var(--border);
    background: var(--panel);
    border-radius: 22px;
    padding: 20px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
  }
  .hero-panel {
    background: linear-gradient(135deg, rgba(24, 39, 34, 0.96), rgba(16, 24, 21, 0.92));
    margin-bottom: 24px;
  }
  .hero-kicker, .panel-kicker {
    color: var(--accent-strong);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 11px;
    margin-bottom: 10px;
  }
  .hero-panel h2, .panel h2 {
    margin: 0 0 10px;
    font-family: "Iowan Old Style", "Palatino Linotype", serif;
    font-size: 28px;
    line-height: 1.08;
  }
  .panel-copy {
    color: var(--muted);
    margin: 0 0 14px;
  }
  .hero-list {
    margin: 0;
    padding-left: 18px;
    color: var(--muted);
    display: grid;
    gap: 10px;
  }
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    font-family: "SF Mono", "Geist Mono", monospace;
  }
  .stat-label {
    margin-top: 8px;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 11px;
  }
  .card-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .mini-card, .detail-card {
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 18px;
    padding: 16px;
    background: var(--panel-alt);
  }
  .mini-eyebrow {
    color: var(--accent-strong);
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.12em;
    margin-bottom: 8px;
  }
  .mini-card h3, .detail-card h3 {
    margin: 0 0 8px;
    font-size: 18px;
  }
  .mini-card p, .detail-card p, .notice-panel ul, .notice-panel li {
    color: var(--muted);
    margin: 0 0 10px;
  }
  .mini-footer {
    color: var(--accent-strong);
    font-size: 13px;
  }
  .metric-list {
    display: grid;
    gap: 12px;
  }
  .metric-row {
    display: grid;
    grid-template-columns: minmax(120px, 1.2fr) minmax(0, 4fr) auto;
    gap: 12px;
    align-items: center;
  }
  .metric-label, .metric-value {
    font-family: "SF Mono", "Geist Mono", monospace;
    font-size: 13px;
  }
  .metric-label { color: var(--muted); }
  .metric-value { color: var(--text); }
  .metric-track {
    height: 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 999px;
    overflow: hidden;
  }
  .metric-fill {
    height: 100%;
    border-radius: inherit;
  }
  .metric-fill.amber { background: linear-gradient(90deg, #8c6842, var(--accent)); }
  .metric-fill.mint { background: linear-gradient(90deg, #2f7a63, var(--mint)); }
  .metric-fill.rose { background: linear-gradient(90deg, #8a544b, var(--rose)); }
  .metric-fill.slate { background: linear-gradient(90deg, #33463f, #7ca18f); }
  .heat-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
  }
  .heat-cell {
    position: relative;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.03);
    height: 58px;
    overflow: hidden;
  }
  .heat-cell-fill {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--mint), var(--accent));
  }
  .heat-hour {
    position: absolute;
    left: 10px;
    bottom: 8px;
    z-index: 1;
    font-family: "SF Mono", "Geist Mono", monospace;
    font-size: 12px;
  }
  .severity-pill {
    display: inline-flex;
    margin-bottom: 10px;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .severity-high, .severity-now {
    background: rgba(255, 134, 120, 0.12);
    color: var(--bad);
  }
  .severity-medium, .severity-next {
    background: rgba(255, 177, 110, 0.12);
    color: var(--warn);
  }
  .severity-low, .severity-later {
    background: rgba(120, 211, 159, 0.12);
    color: var(--good);
  }
  .success-card { border-color: rgba(120, 211, 159, 0.16); }
  .warning-card { border-color: rgba(255, 177, 110, 0.16); }
  .action-card { border-color: rgba(211, 168, 108, 0.18); }
  .horizon-card { border-color: rgba(99, 199, 166, 0.18); }
  .copy-wrap {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }
  .copy-box {
    margin: 0;
    white-space: pre-wrap;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    padding: 12px;
    color: #f6efe4;
    font-family: "SF Mono", "Geist Mono", monospace;
    font-size: 12px;
  }
  .copy-button {
    justify-self: start;
    border: 0;
    border-radius: 999px;
    padding: 10px 14px;
    background: linear-gradient(90deg, #7b5c39, var(--accent));
    color: #111;
    cursor: pointer;
    font-weight: 700;
  }
  .notice-panel ul {
    padding-left: 18px;
    margin: 10px 0 0;
  }
  .ending-panel blockquote {
    margin: 0 0 12px;
    padding-left: 16px;
    border-left: 3px solid var(--accent);
    color: #f5e8d8;
    font-family: "Iowan Old Style", "Palatino Linotype", serif;
    font-size: 20px;
  }
  .footer {
    color: var(--faint);
    text-align: center;
    margin-top: 20px;
    font-size: 13px;
  }
  @media (max-width: 980px) {
    .stats-grid, .two-col, .three-col {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 720px) {
    .wrap { width: min(100vw - 20px, 100%); padding-top: 20px; }
    .masthead, .stat-card, .panel, .hero-panel { border-radius: 18px; }
    .stats-grid, .two-col, .three-col { grid-template-columns: 1fr; }
    .metric-row { grid-template-columns: 1fr; }
    .heat-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="masthead">
      <div class="eyebrow">TermCanvas Intelligence Report</div>
      <h1>Cross-session guidance for how you actually use ${escapeHtml(formatLabel(stats.sourceCli))}</h1>
      <p>Generated ${escapeHtml(dateStr)}. This version emphasizes hard metrics first, structured analysis second, and practical prompts you can paste back into Claude or Codex without rewriting them.</p>
      <div class="meta-strip">
        <div class="meta-pill">Source CLI: ${escapeHtml(formatLabel(stats.sourceCli))}</div>
        <div class="meta-pill">Analyzer CLI: ${escapeHtml(formatLabel(stats.analyzerCli))}</div>
        <div class="meta-pill">${formatNumber(stats.totalSessions)} analyzed / ${formatNumber(stats.totalScannedSessions)} scanned</div>
        <div class="meta-pill">${formatNumber(stats.cachedFacetSessions)} cached facets</div>
      </div>
    </header>

    ${statCards(insights)}
    ${atAGlance(insights.atAGlance)}
    ${coveragePanel(insights)}

    <div class="two-col">
      ${stackedBars("Outcome Mix", stats.outcomeBreakdown, "mint")}
      ${stackedBars("Project Areas", stats.projectAreaBreakdown, "amber")}
    </div>

    <div class="three-col">
      ${stackedBars("Top Tools", stats.toolBreakdown, "slate")}
      ${stackedBars("Languages", stats.languageBreakdown, "mint")}
      ${stackedBars("Friction Signals", stats.frictionCounts, "rose")}
    </div>

    <div class="two-col">
      ${stackedBars("Assistant Response Times", stats.responseTimeBreakdown, "amber")}
      ${stackedBars("User Follow-up Times", stats.userReplyBreakdown, "slate")}
    </div>

    <div class="two-col">
      ${heatmap(stats.messageHourBreakdown)}
      ${stackedBars("Feature Usage", stats.featureUsageBreakdown, "mint")}
    </div>

    <div class="two-col">
      ${projectAreas(insights.projectAreas)}
      ${interactionStyle(insights.interactionStyle)}
    </div>

    <div class="two-col">
      ${whatWorks(insights.whatWorks)}
      ${frictionAnalysis(insights.frictionAnalysis)}
    </div>

    ${suggestions(insights.suggestions)}
    ${horizon(insights.onTheHorizon)}
    ${funEnding(insights)}

    <div class="footer">Generated by TermCanvas · Rich session metrics, structured AI synthesis, and timestamped historical reports.</div>
  </div>
  <script>
    for (const button of document.querySelectorAll(".copy-button")) {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-copy-target");
        const node = id ? document.getElementById(id) : null;
        if (!node) return;
        const text = node.textContent || "";
        try {
          await navigator.clipboard.writeText(text);
          const old = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => { button.textContent = old; }, 1200);
        } catch {
          button.textContent = "Copy failed";
        }
      });
    }
  </script>
</body>
</html>`;

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
  const filename = `insights-${timestamp}.html`;
  const filePath = path.join(reportsDir, filename);
  fs.writeFileSync(filePath, html, "utf-8");
  return filePath;
}
