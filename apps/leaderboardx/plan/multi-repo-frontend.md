# PRD: Multi-Repository Frontend Enhancements

**Document Version:** 1.0
**Date:** 2023-10-27
**Author:** AI Product Manager

## 1. Overview and Objectives

This document outlines the frontend requirements for evolving the ElizaOS analytics platform from a single-repository view to a multi-repository system. The goal is to provide users with both high-level, aggregated views of the entire project ecosystem and detailed, drill-down views for each individual repository.

This initiative will enhance the platform's utility for project managers, contributors, and community members by offering a more holistic and comparable perspective on development activity across all tracked repositories.

## 2. Target Audience

- **Project Leads & Maintainers:** Need to monitor the health and activity of all repositories at a glance and identify which projects require attention.
- **Developers & Contributors:** Want to see how their work contributes to specific repositories and discover other active projects within the ecosystem.
- **Community Members & Stakeholders:** Seek a high-level understanding of overall project progress and momentum.
- **Users and Builders:** Want to see what new features are being worked on or implemented so they can use elizaOS more effectively

## 3. Core Features and Functionality

### 3.1. Feature 1: Overall Project Summary Page

- **Description:** The existing summary pages (accessed via `/day`, `/week`, `/month`) will be repurposed to display aggregated, project-wide data instead of single-repository data.
- **User Interface:**
  - The current layout, including the Stat Cards, Code Changes display, and Interval Selector, will be maintained.
  - All metrics displayed on these components (e.g., contributor counts, PR/issue totals, lines of code) will be aggregated across all tracked repositories for the selected time interval.
- **Data Requirements:**
  - The `getMetricsForInterval` query in `src/app/[interval]/[[...date]]/queries.ts` will continue to be used for fetching aggregated statistics.
  - The `getIntervalSummaryContent` query must be modified to fetch the "Overall Summary" content from the `overallSummaries` table (or its corresponding markdown file), removing the existing hardcoded repository ID.
- **Component Behavior:**
  - Clicking on the Stat Cards (Contributors, Pull Requests, Issues) will open a modal window.
  - The content of these modals will display an aggregated list of the top contributors, PRs, and issues from across all repositories for the selected time frame.

### 3.2. Feature 2: Repository List Page

- **Description:** A new page will be created to list all tracked repositories, providing a comparative overview of their activity.
- **URL:** The page will be accessible at `/repos`.
- **User Interface:**
  - The page will display a list of "repository cards."
  - The list will be sorted by the number of unique contributors over the last three months, with the most active repositories appearing first.
- **Repository Card Component:** Each card in the list will contain:
  - **Repository Name:** Displayed as `{owner}/{name}`.
  - **Top Contributors:** Avatars of the top 3 all-time contributors for that repository.
  - **Activity Graph:** A simple line graph visualizing the number of weekly commits over the last three months.
- **Data Requirements:**
  - A new query will be needed to fetch a list of all repositories, sorted by their active contributor count over the last 90 days.
  - For each repository, the query must also provide:
    - The names of the top 3 all-time contributors (to construct avatar URLs).
    - A time-series dataset of weekly commit counts for the last 90 days.

### 3.3. Feature 3: Repository Detail Page

- **Description:** A new page to display detailed analytics for a single repository, serving as a repository-specific counterpart to the existing user profile page.
- **URL:** The page will follow the structure `/repos/{owner}/{name}` (e.g., `/repos/elizaos/eliza`).
- **User Interface:** The page will adopt a two-column layout similar to the user profile page.
  - **Header:** Will prominently display the repository name, a link to its GitHub page, and a new AI-generated repository description.
  - **Left Column:**
    - A `SummaryCard` component to display and cycle through the monthly AI-generated summaries for this specific repository.
    - A daily activity heatmap showing commit history for the repository over the last year.
  - **Right Column:**
    - Stat cards showing totals for PRs, Issues, and active contributors specific to this repo.
    - A list of the **Top 10 Contributors** for the repository (all-time), showing their avatar and username. Each contributor listed will link to their respective user profile page.
    - A list of currently open "Active PRs" for the repository.
- **Data Requirements:**
  - A new pipeline step in the `summarize` stage will be required to generate and store a static, AI-generated description for each repository. This will need to be stored in a new column in the `repositories` table.
  - A new query, `getRepoProfile`, will be needed to fetch all the necessary data for this page, including the new AI-generated description, monthly summaries, stats, activity data, top contributors, and active PRs, all scoped to the specific repository.

## 4. Technical Stack

The implementation will adhere to the existing technical stack:

- **Frontend:** Next.js (App Router), React, TypeScript
- **UI:** Tailwind CSS, shadcn/ui
- **Data Fetching:** Direct database queries from Next.js Server Components.

## 5. Development Phases

1.  **Phase 1: Main Summary Page Refactor**
    - Update `getIntervalSummaryContent` to fetch and display the overall summary.
    - Verify that all stats and modal content on the page are correctly aggregated across all repositories.
2.  **Phase 2: Repository List Page Implementation**
    - Create the new page component at `src/app/repos/page.tsx`.
    - Develop the necessary queries to fetch the sorted list of repositories with their associated data (top contributors, activity graph data).
    - Create the `RepositoryCard` component.
3.  **Phase 3: Repository Detail Page Implementation**
    - _(Backend Task)_ Add a pipeline step to generate and store AI descriptions for repositories.
    - Create the dynamic page at `src/app/repos/[owner]/[name]/page.tsx`.
    - Develop the `getRepoProfile` query to fetch all data for the detail view.
    - Assemble the page layout using existing and new components as described.
4.  **Phase 4: Navigation and Testing**
    - Add a link to the new `/repos` page in the main site navigation.
    - Ensure all links between the repository list, detail, and user profile pages work correctly.
    - Conduct end-to-end testing of the new user flow.
