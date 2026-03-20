import fs from "fs";
import path from "path";
import { TERMCANVAS_DIR } from "./state-persistence";

interface AggregatedStats {
  totalSessions: number;
  totalMessages: number;
  totalDurationMinutes: number;
  cliBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  sessionTypeBreakdown: Record<string, number>;
  goalCategories: Record<string, number>;
  frictionCounts: Record<string, number>;
  satisfactionBreakdown: Record<string, number>;
  projectBreakdown: Record<string, number>;
}

interface InsightsResult {
  stats: AggregatedStats;
  projectAreas: string;
  interactionStyle: string;
  whatWorks: string;
  frictionAnalysis: string;
  suggestions: string;
  atAGlance: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(text: string): string {
  const blocks = text.split(/\n\n+/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");

      // Check if all lines are bullet items
      const bulletLines = lines.filter((l) => /^\s*[-*\u2022]\s/.test(l));
      if (bulletLines.length > 0 && bulletLines.length === lines.length) {
        const items = lines
          .map((l) => {
            const content = escapeHtml(l.replace(/^\s*[-*\u2022]\s+/, ""));
            return `<li>${applyInline(content)}</li>`;
          })
          .join("");
        return `<ul>${items}</ul>`;
      }

      // Check for headings
      if (lines.length === 1) {
        const h2 = lines[0].match(/^##\s+(.+)/);
        if (h2) return `<h2>${escapeHtml(h2[1])}</h2>`;
        const h1 = lines[0].match(/^#\s+(.+)/);
        if (h1) return `<h1>${escapeHtml(h1[1])}</h1>`;
      }

      // Default: paragraph
      const escaped = escapeHtml(block);
      return `<p>${applyInline(escaped)}</p>`;
    })
    .join("\n");
}

function applyInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function progressBar(value: number, total: number, color: string): string {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return `<div class="progress-bar">
    <div class="progress-fill" style="width: ${pct}%; background: ${color};"></div>
    <span class="progress-label">${value} (${pct}%)</span>
  </div>`;
}

function breakdownSection(
  title: string,
  data: Record<string, number>,
  color: string,
): string {
  const entries = Object.entries(data);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return "";

  entries.sort((a, b) => b[1] - a[1]);

  const rows = entries
    .map(
      ([label, value]) =>
        `<div class="breakdown-row">
      <span class="breakdown-label">${escapeHtml(label)}</span>
      ${progressBar(value, total, color)}
    </div>`,
    )
    .join("");

  return `<div class="section">
    <h2 class="section-title">${escapeHtml(title)}</h2>
    ${rows}
  </div>`;
}

function textSection(title: string, text: string): string {
  return `<div class="section">
    <h2 class="section-title">${escapeHtml(title)}</h2>
    <div class="section-text">${markdownToHtml(text)}</div>
  </div>`;
}

export function generateReport(insights: InsightsResult): string {
  const reportsDir = path.join(TERMCANVAS_DIR, "insights-reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const { stats } = insights;
  const totalHours = (stats.totalDurationMinutes / 60).toFixed(1);
  const cliToolsCount = Object.keys(stats.cliBreakdown).length;
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
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0a0a0b;
    color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    padding: 2rem 1rem;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .container { max-width: 860px; margin: 0 auto; }
  .header { text-align: center; margin-bottom: 2rem; }
  .header h1 {
    font-size: 2rem;
    font-weight: 700;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 0.5rem;
  }
  .header .subtitle { color: #71717a; font-size: 0.9rem; }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .stat-card {
    background: #141416;
    border: 1px solid #2a2a2e;
    border-radius: 0.75rem;
    padding: 1.25rem;
    text-align: center;
  }
  .stat-value {
    font-size: 1.5rem;
    font-weight: 600;
    font-family: "SF Mono", "Fira Code", monospace;
    color: #e4e4e7;
  }
  .stat-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #71717a;
    margin-top: 0.25rem;
  }
  .section {
    background: #141416;
    border: 1px solid #2a2a2e;
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .section-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: #e4e4e7;
    margin-bottom: 1rem;
  }
  .section-text p, .section-text li {
    color: #a1a1aa;
    font-size: 0.9rem;
    line-height: 1.7;
  }
  .section-text p { margin-bottom: 0.75rem; }
  .section-text ul {
    list-style: none;
    padding-left: 0;
    margin-bottom: 0.75rem;
  }
  .section-text li::before {
    content: "\\2192  ";
    color: #71717a;
  }
  .section-text li { margin-bottom: 0.35rem; }
  .section-text h1, .section-text h2 {
    color: #e4e4e7;
    margin-bottom: 0.5rem;
    margin-top: 0.5rem;
  }
  .section-text h1 { font-size: 1.1rem; }
  .section-text h2 { font-size: 1rem; }
  .section-text strong { color: #e4e4e7; }
  .breakdown-row {
    display: flex;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .breakdown-label {
    width: 140px;
    flex-shrink: 0;
    font-size: 0.85rem;
    color: #a1a1aa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .progress-bar {
    flex: 1;
    height: 20px;
    background: #0a0a0b;
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  .progress-label {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.75rem;
    font-family: "SF Mono", "Fira Code", monospace;
    color: #e4e4e7;
  }
  .footer {
    text-align: center;
    color: #71717a;
    font-size: 0.8rem;
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid #2a2a2e;
  }
  @media (max-width: 600px) {
    .stats-grid { grid-template-columns: 1fr; }
    .breakdown-row { flex-direction: column; align-items: stretch; }
    .breakdown-label { width: 100%; margin-bottom: 0.25rem; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>TermCanvas Insights</h1>
    <p class="subtitle">${escapeHtml(dateStr)} &middot; ${stats.totalSessions} sessions analyzed</p>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${stats.totalSessions}</div>
      <div class="stat-label">Sessions Analyzed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.totalMessages}</div>
      <div class="stat-label">Total Messages</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalHours}h</div>
      <div class="stat-label">Total Time</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${cliToolsCount}</div>
      <div class="stat-label">CLI Tools Used</div>
    </div>
  </div>

  ${textSection("At a Glance", insights.atAGlance)}
  ${breakdownSection("CLI Tools", stats.cliBreakdown, "#6366f1")}
  ${breakdownSection("Outcomes", stats.outcomeBreakdown, "#22c55e")}
  ${breakdownSection("Session Types", stats.sessionTypeBreakdown, "#06b6d4")}
  ${breakdownSection("Goal Categories", stats.goalCategories, "#a855f7")}
  ${breakdownSection("Friction Points", stats.frictionCounts, "#ef4444")}
  ${breakdownSection("Projects", stats.projectBreakdown, "#eab308")}
  ${textSection("What You Work On", insights.projectAreas)}
  ${textSection("How You Use These Tools", insights.interactionStyle)}
  ${textSection("What Works Well", insights.whatWorks)}
  ${textSection("Where Things Go Wrong", insights.frictionAnalysis)}
  ${textSection("Suggestions", insights.suggestions)}

  <div class="footer">Generated by TermCanvas &middot; Cross-CLI Insights Engine</div>
</div>
</body>
</html>`;

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
  const filename = `insights-${timestamp}.html`;
  const filePath = path.join(reportsDir, filename);
  fs.writeFileSync(filePath, html, "utf-8");
  return filePath;
}
