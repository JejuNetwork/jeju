# Implementation Plan: Copy to LLM Feature

This document outlines the plan to add a "Copy to LLM" feature to the Interval Summary page. This feature will allow users to copy the page's content in a Markdown/XML format suitable for pasting into Large Language Models (LLMs).

## 1. Overview

The feature will consist of:

- A "Copy to LLM" button on the `IntervalSummaryPage`.
- A dropdown menu associated with the button, allowing users to select which parts of the data to include:
  - Stats (selected by default)
  - Summary (selected by default)
  - Item Details (optional)
- A function to format the selected data into a structured Markdown/XML string.
- Client-side logic to trigger the formatting and copy the result to the clipboard.

## 2. File Changes and New Components

### 2.1. New Client Component: `src/components/ui/llm-copy-button.tsx`

This component will encapsulate the "Copy to LLM" button, its dropdown menu, and the copy logic.

- **Purpose:** Provide UI for selecting content types and triggering the copy action.
- **Type:** Client Component (`"use client";`).
- **Props:**
  ```typescript
  interface LlmCopyButtonProps {
    metrics: IntervalMetrics; // from src/app/[interval]/[[...date]]/queries.ts
    summaryContent: string | null;
  }
  ```
- **State:**
  ```typescript
  const [includeStats, setIncludeStats] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeItemDetails, setIncludeItemDetails] = useState(false);
  ```
- **UI:**
  - Use Shadcn UI `Button` for the main "Copy to LLM" button.
  - Use Shadcn UI `DropdownMenu` components (`DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuCheckboxItem`, `DropdownMenuItem`) for the options.
    - Checkbox items for "Stats", "Summary", "Item Details".
    - A final "Copy" item or the main button itself triggers the copy action.
- **Logic:**
  - `handleCopy`:
    - Calls `formatDataForLLM` (see section 2.2) with `metrics`, `summaryContent`, and the current state of `includeStats`, `includeSummary`, `includeItemDetails`.
    - Uses `navigator.clipboard.writeText()` to copy the formatted string.
    - Displays a toast notification (e.g., using a library like `sonner` or a simple alert) on success/failure.

### 2.2. New Utility Module: `src/lib/llm-formatter.ts`

This module will contain the logic for formatting the data.

- **Purpose:** Convert `IntervalMetrics` and summary content into a structured Markdown/XML string.
- **Exports:**

  ```typescript
  import type { IntervalMetrics } from "@/app/[interval]/[[...date]]/queries";

  interface FormatOptions {
    includeStats: boolean;
    includeSummary: boolean;
    includeItemDetails: boolean;
  }

  export function formatDataForLLM(
    metrics: IntervalMetrics,
    summaryContent: string | null,
    options: FormatOptions,
  ): string {
    // Implementation details below
  }
  ```

- **Formatting Logic (`formatDataForLLM`):**

  - Initialize an empty array `parts` to store sections of the output.
  - **Preamble (Optional but good practice):**
    ```markdown
    parts.push(`<!-- Data for interval: ${metrics.interval.intervalType} covering ${metrics.interval.intervalStart} to ${metrics.interval.intervalEnd} -->`);
    parts.push(`<llm_copy_data interval_type="${metrics.interval.intervalType}" start_date="${toDateString(metrics.interval.intervalStart)}" end_date="${toDateString(metrics.interval.intervalEnd)}">`);
    ```
  - **If `options.includeStats`:**

    - Add a `<stats>` section or Markdown heading.
    - Format `metrics.pullRequests` (new, merged, total).
    - Format `metrics.issues` (new, closed, total).
    - Format `metrics.activeContributors`.
    - Format `metrics.codeChanges` (commitCount, files, additions, deletions).
    - Example Markdown structure:

      ```markdown
      ## Statistics Summary

      ### Pull Requests

      - New: ${metrics.pullRequests.new}
      - Merged: ${metrics.pullRequests.merged}
      - Total Unique: ${metrics.pullRequests.total}

      ### Issues

      - New: ${metrics.issues.new}
      - Closed: ${metrics.issues.closed}
      - Total Unique: ${metrics.issues.total}

      ### Contributors

      - Active Contributors: ${metrics.activeContributors}

      ### Code Changes

      - Commits: ${metrics.codeChanges.commitCount}
      - Files Changed: ${metrics.codeChanges.files}
      - Lines Added: +${metrics.codeChanges.additions.toLocaleString()}
      - Lines Deleted: -${metrics.codeChanges.deletions.toLocaleString()}
      ```

    - Example XML structure:
      ```xml
      <stats>
        <pullRequests>
          <new>${metrics.pullRequests.new}</new>
          <merged>${metrics.pullRequests.merged}</merged>
          <total>${metrics.pullRequests.total}</total>
        </pullRequests>
        <issues>
          <new>${metrics.issues.new}</new>
          <closed>${metrics.issues.closed}</closed>
          <total>${metrics.issues.total}</total>
        </issues>
        <activeContributors>${metrics.activeContributors}</activeContributors>
        <codeChanges>
          <commits>${metrics.codeChanges.commitCount}</commits>
          <filesChanged>${metrics.codeChanges.files}</filesChanged>
          <linesAdded>${metrics.codeChanges.additions}</linesAdded>
          <linesDeleted>${metrics.codeChanges.deletions}</linesDeleted>
        </codeChanges>
      </stats>
      ```

  - **If `options.includeSummary` and `summaryContent`:**

    - Add a `<summary_content>` section or Markdown heading.
    - Append `summaryContent`. It's already Markdown, so it can be included directly.
    - Example Markdown:

      ```markdown
      ## Summary

      ${summaryContent}
      ```

    - Example XML:
      ```xml
      <summary_content>
        <![CDATA[
      ${summaryContent}
        ]]>
      </summary_content>
      ```

  - **If `options.includeItemDetails`:**
    - **Top Contributors:**
      - Add a `<top_contributors>` section or "### Top Contributors" heading.
      - Iterate over `metrics.topContributors`.
      - For each contributor: ` - ${username} (Score: ${totalScore})` or `<contributor username="${username}" score="${totalScore}" />`.
    - **Top Pull Requests:**
      - Add a `<top_pull_requests>` section or "### Top Pull Requests" heading.
      - Iterate over `metrics.topPullRequests`.
      - For each PR:
        - Markdown: `- PR #${number}: ${title} by @${author} (Status: ${mergedAt ? 'Merged' : 'New'}) - Link: https://github.com/${repository}/pull/${number}`
        - XML: `<pull_request number="${number}" title="${title}" author="${author}" status="${mergedAt ? 'Merged' : 'New'}" link="https://github.com/${repository}/pull/${number}" />`
    - **Top Issues:**
      - Add a `<top_issues>` section or "### Top Issues" heading.
      - Iterate over `metrics.topIssues`.
      - For each issue:
        - Markdown: `- Issue #${number}: ${title} by @${author} (Status: ${state}, Comments: ${commentCount}) - Link: https://github.com/${repository}/issues/${number}`
        - XML: `<issue number="${number}" title="${title}" author="${author}" status="${state}" comments="${commentCount}" link="https://github.com/${repository}/issues/${number}" />`
  - **Postamble:**
    ```markdown
    parts.push(`</llm_copy_data>`);
    ```
  - Join `parts` with `\n\n` for Markdown or `\n` for XML.
  - **Decision:** Choose Markdown or XML for the output. Markdown is simpler and more human-readable. XML provides better structure for programmatic parsing if the LLM needs to extract specific fields. Given the primary goal is "pasting into an LLM," Markdown is likely sufficient and easier to implement. _Let's proceed with Markdown._

### 2.3. Modifications to `src/app/[interval]/[[...date]]/page.tsx`

- **Purpose:** Integrate the `LlmCopyButton` into the page.
- **Changes:**

  - Import `LlmCopyButton`.
  - Import `IntervalMetrics` type if not already.
  - In the `IntervalSummaryPage` component, after fetching `metrics` and `summaryContent`, render the `LlmCopyButton`:

    ```tsx
    // ... other imports
    import { LlmCopyButton } from "@/components/ui/llm-copy-button"; // Adjust path as needed
    import type { IntervalMetrics } from "./queries"; // Ensure type is available

    // ...
    export default async function IntervalSummaryPage({ params }: PageProps) {
      // ... existing logic to fetch metrics and summaryContent

      return (
        <div className="container mx-auto px-6 py-8 md:px-8">
          <div className="mx-auto max-w-4xl">
            <DateNavigation {...navigation} />
            {/* Add the LlmCopyButton here, perhaps aligned to the right or below DateNavigation */}
            <div className="mb-4 flex justify-end">
              {" "}
              {/* Example positioning */}
              <LlmCopyButton
                metrics={metrics}
                summaryContent={summaryContent}
              />
            </div>
            <div className="mb-8 space-y-6">
              <StatCardsDisplay metrics={metrics} />
              <CodeChangesDisplay metrics={metrics} />
            </div>
            <SummaryContent summaryContent={summaryContent} />
          </div>
        </div>
      );
    }
    ```

## 3. Shadcn UI Dependencies

Ensure necessary Shadcn UI components are installed/available:

- `Button`
- `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuCheckboxItem`, `DropdownMenuItem`
- Icons (e.g., from `lucide-react` for a copy icon).

## 4. Styling

- The `LlmCopyButton` should be styled to fit cohesively with the existing page design.
- Consider placement:
  - Top-right of the main content area.
  - Near the `DateNavigation` component.
  - As a floating action button (FAB) if that fits the UI style.

## 5. Data for Formatting

The `formatDataForLLM` function will use the following fields from the `metrics` object (`IntervalMetrics` type):

- `metrics.interval.intervalType`
- `metrics.interval.intervalStart` (needs `toDateString` from `date-utils`)
- `metrics.interval.intervalEnd` (needs `toDateString` from `date-utils`)
- `metrics.pullRequests.new`
- `metrics.pullRequests.merged`
- `metrics.pullRequests.total`
- `metrics.issues.new`
- `metrics.issues.closed`
- `metrics.issues.total`
- `metrics.activeContributors`
- `metrics.codeChanges.commitCount`
- `metrics.codeChanges.files`
- `metrics.codeChanges.additions`
- `metrics.codeChanges.deletions`
- `metrics.topContributors`: Array of `{ username: string; totalScore: number; }`
- `metrics.topPullRequests`: Array of PR objects (need `id`, `title`, `body`, `author`, `number`, `repository`, `mergedAt`).
- `metrics.topIssues`: Array of Issue objects (need `id`, `title`, `body`, `author`, `number`, `repository`, `state`, `commentCount`).
- `summaryContent`: string (already Markdown).

## 6. Architectural Decisions

- **Client-Side Copy:** The copy functionality will be purely client-side using `navigator.clipboard`. No backend interaction is needed for this feature.
- **Markdown Output:** The primary output format will be Markdown for ease of use and readability. XML-like tags can be embedded in comments for metadata if needed (`<!-- ... -->`).
- **Component Encapsulation:** The button and its dropdown logic will be encapsulated in a new client component (`LlmCopyButton`) for better separation of concerns, as `page.tsx` is a Server Component.

## 7. Potential Enhancements (Future Considerations)

- Option to choose between Markdown and XML format.
- More granular control over which specific stats or item details to include.
- Direct integration with an LLM API (though this is out of scope for the current request).
