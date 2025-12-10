import type { IntervalMetrics } from "@/app/summary/[interval]/[[...date]]/queries";

interface FormatOptions {
  includeStats: boolean;
  includeSummary: boolean;
  includePrData: boolean;
  includeIssueData: boolean;
  includeDetailedContributorSummaries?: boolean;
}

// Helper to sanitize body content: remove HTML comments, make it single-line and escape newlines
function sanitizeBodyText(
  text: string | undefined | null,
  maxLength = 500,
): string {
  if (!text) return "";

  // Remove HTML comments (like <!-- ... -->)
  let processedText = text.replace(/<!--[\s\S]*?-->/g, "");

  // Trim whitespace
  processedText = processedText.trim();

  // Replace all types of newlines with \n
  processedText = processedText.replace(/\r\n|\n|\r/g, "\\n");

  return processedText.slice(0, maxLength);
}

export function formatDataForLLM(
  metrics: IntervalMetrics,
  summaryContent: string | null,
  options: FormatOptions,
): string {
  const parts: string[] = [];

  // Metadata Section
  parts.push("## Metadata");
  parts.push("```json");
  parts.push("{");
  parts.push(`  "interval_type": "${metrics.interval.intervalType}",`);
  parts.push(`  "start_date": "${metrics.interval.intervalStart}",`);
  parts.push(`  "end_date": "${metrics.interval.intervalEnd}"`);
  parts.push("}");
  parts.push("```");
  parts.push("");

  // Statistics Section
  if (options.includeStats) {
    parts.push("## Statistics");
    parts.push("```json");
    parts.push("{");
    parts.push('  "pull_requests": {');
    parts.push(`    \"new\": ${metrics.pullRequests.new},`);
    parts.push(`    \"merged\": ${metrics.pullRequests.merged},`);
    parts.push(`    \"total_unique\": ${metrics.pullRequests.total}`);
    parts.push("  },");
    parts.push('  "issues": {');
    parts.push(`    \"new\": ${metrics.issues.new},`);
    parts.push(`    \"closed\": ${metrics.issues.closed},`);
    parts.push(`    \"total_unique\": ${metrics.issues.total}`);
    parts.push("  },");
    parts.push('  "contributors": {');
    parts.push(`    \"active\": ${metrics.activeContributors}`);
    parts.push("  },");
    parts.push('  "code_changes": {');
    parts.push(`    \"commits\": ${metrics.codeChanges.commitCount},`);
    parts.push(`    \"files_changed\": ${metrics.codeChanges.files},`);
    parts.push(
      `    \"lines_added\": ${metrics.codeChanges.additions.toLocaleString()},`,
    );
    parts.push(
      `    \"lines_deleted\": ${metrics.codeChanges.deletions.toLocaleString()}`,
    );
    parts.push("  }");
    parts.push("}");
    parts.push("```");
    parts.push("");
  }

  // Summary Section
  if (options.includeSummary && summaryContent) {
    parts.push("## Summary");
    parts.push(summaryContent);
    parts.push("");
  }

  // Top Contributors
  if (metrics.topContributors && metrics.topContributors.length > 0) {
    parts.push("## Top Contributors");
    parts.push("```json");
    parts.push("/* Top contributors for this period */");
    parts.push("[");
    metrics.topContributors.forEach((contributor, index) => {
      const comma = index < metrics.topContributors!.length - 1 ? "," : "";
      parts.push(`  {`);
      parts.push(`    "username": "${contributor.username}",`);
      parts.push(`    "score": ${contributor.totalScore}`);
      parts.push(`  }${comma}`);
    });
    parts.push("]");
    parts.push("```");
    parts.push("");
  }

  // Detailed Contributor Summaries Section
  if (
    options.includeDetailedContributorSummaries &&
    metrics.detailedContributorSummaries &&
    Object.keys(metrics.detailedContributorSummaries).length > 0
  ) {
    parts.push("## Detailed Contributor Summaries");
    parts.push("");

    for (const [username, summary] of Object.entries(
      metrics.detailedContributorSummaries,
    )) {
      if (summary && summary.trim() !== "") {
        parts.push(`### ${username}`);
        parts.push(summary);
        parts.push("");
      }
    }
  }

  // Pull Requests Section
  if (
    options.includePrData &&
    metrics.topPullRequests &&
    metrics.topPullRequests.length > 0
  ) {
    parts.push("## Pull Requests");
    parts.push("```json");
    parts.push("[");
    metrics.topPullRequests.forEach((pr, index) => {
      const comma = index < metrics.topPullRequests!.length - 1 ? "," : "";
      parts.push(`  {`);
      parts.push(`    "number": ${pr.number},`);
      parts.push(`    "title": "${pr.title.replace(/"/g, '\\"')}",`);
      parts.push(`    "author": "${pr.author}",`);
      parts.push(`    "status": "${pr.mergedAt ? "Merged" : "New"}",`);
      parts.push(
        `    "link": "https://github.com/${pr.repository}/pull/${pr.number}",`,
      );
      parts.push(
        `    "body": "${sanitizeBodyText(pr.body || "Body not available.", 750).replace(/"/g, '\\"')}"`,
      );
      parts.push(`  }${comma}`);
    });
    parts.push("]");
    parts.push("```");
    parts.push("");
  }

  // Issues Section
  if (
    options.includeIssueData &&
    metrics.topIssues &&
    metrics.topIssues.length > 0
  ) {
    parts.push("## Issues");
    parts.push("```json");
    parts.push("[");
    metrics.topIssues.forEach((issue, index) => {
      const comma = index < metrics.topIssues!.length - 1 ? "," : "";
      parts.push(`  {`);
      parts.push(`    "number": ${issue.number},`);
      parts.push(`    "title": "${issue.title.replace(/"/g, '\\"')}",`);
      parts.push(`    "author": "${issue.author}",`);
      parts.push(`    "state": "${issue.state}",`);
      parts.push(`    "comments": ${issue.commentCount},`);
      parts.push(
        `    "link": "https://github.com/${issue.repository}/issues/${issue.number}",`,
      );
      parts.push(
        `    "body": "${sanitizeBodyText(issue.body || "Body not available.").replace(/"/g, '\\"')}"`,
      );
      parts.push(`  }${comma}`);
    });
    parts.push("]");
    parts.push("```");
    parts.push("");
  }

  return parts.join("\n");
}
