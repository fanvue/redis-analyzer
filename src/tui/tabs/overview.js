import { bold, cyan, dim, green, red, redBright, yellow, yellowBright } from "colorette";
import { buildJsonOutput } from "../../utils/analysis.js";
import { formatDelta } from "../../utils/comparison.js";
import {
  formatBytes,
  formatPercent,
  statusBadge,
  statusIcon,
} from "../../utils/format.js";
import { generateRecommendations } from "../../utils/recommendations.js";

/**
 * Render the Overview tab content.
 *
 * @param {{ result: object, cols: number, contentRows: number, previousReport: object | null, parsedUrl: URL, displayHost: string }} options
 * @returns {string[]}
 */
export function renderOverviewTab({ result, cols, contentRows, previousReport, parsedUrl, displayHost }) {
  const lines = [];
  const { results, warnings, criticals } = result;

  // Overall status
  const overallStatus = criticals > 0 ? "critical" : warnings > 0 ? "warning" : "ok";
  lines.push("");
  lines.push(`  ${bold("Overall Status:")} ${statusBadge(overallStatus)}  ${bold(red(`${criticals} critical`))}  ${bold(yellow(`${warnings} warning(s)`))}`);
  lines.push("");

  // Per-section status
  const sections = [
    results.memory,
    results.performance,
    results.connections,
    results.keyPatterns,
    results.replication,
  ].filter(Boolean);

  const sectionLine = sections
    .map((section) => `${statusIcon(section.status)} ${dim(section.title.toLowerCase())}`)
    .join("  ");
  lines.push(`  ${sectionLine}`);
  lines.push("");

  // All findings
  const allFindings = sections.flatMap((section) =>
    section.findings.map((finding) => ({ finding, status: section.status }))
  );

  if (allFindings.length > 0) {
    lines.push(`  ${bold("Findings:")}`);
    for (const { finding, status } of allFindings) {
      const icon = status === "critical" ? red("✗") : yellow("⚠");
      const coloredMessage = status === "critical" ? redBright(finding) : yellowBright(finding);
      lines.push(`    ${icon}  ${coloredMessage}`);
    }
  } else {
    lines.push(`  ${green("✓")} ${bold("No issues found — all checks passed.")}`);
  }

  // Comparison delta section
  if (previousReport) {
    lines.push("");
    lines.push(`  ${bold(cyan("COMPARISON WITH PREVIOUS RUN"))}`);
    lines.push(`  ${dim("Previous:")} ${dim(previousReport.timestamp || "unknown")}`);

    const currentJson = buildJsonOutput(parsedUrl, displayHost, result);

    if (currentJson.memory?.metrics && previousReport.memory?.metrics) {
      const cm = currentJson.memory.metrics;
      const pm = previousReport.memory.metrics;
      if (cm.usedMemory !== undefined && pm.usedMemory !== undefined) {
        lines.push(`    Memory Used: ${formatBytes(cm.usedMemory)} ${formatDelta(cm.usedMemory, pm.usedMemory, { formatter: formatBytes })}`);
      }
    }
    if (currentJson.performance?.metrics && previousReport.performance?.metrics) {
      const cp = currentJson.performance.metrics;
      const pp = previousReport.performance.metrics;
      if (cp.hitRate !== undefined && pp.hitRate !== undefined) {
        lines.push(`    Hit Rate: ${formatPercent(cp.hitRate)} ${formatDelta(cp.hitRate, pp.hitRate, { higherIsBetter: true, formatter: formatPercent })}`);
      }
    }
  }

  // Recommendations
  const recommendations = generateRecommendations(sections);
  if (recommendations.length > 0) {
    lines.push("");
    lines.push(`  ${bold(cyan("RECOMMENDED ACTIONS"))}`);
    for (let index = 0; index < recommendations.length; index++) {
      const rec = recommendations[index];
      lines.push(`    ${bold(yellow(`${index + 1}. ${rec.title}`))}`);
      for (const action of rec.actions) {
        lines.push(`       ${dim("→")} ${action}`);
      }
    }
  }

  // Pad or truncate to contentRows
  while (lines.length < contentRows) {
    lines.push("");
  }
  return lines.slice(0, contentRows);
}
