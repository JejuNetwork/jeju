Okay, let's architect a plan to improve the contribution scoring algorithm. The goal is to reward genuine impact more effectively and reduce the potential for gaming the system.

Here's a breakdown of the proposed enhancements and the implementation plan:

**I. Proposed Scoring Enhancements:**

1.  **Reaction-Based Scoring:** Award points for positive reactions (👍, ❤️, 🎉) received on:

    - PR Descriptions
    - Issue Descriptions
    - PR Comments
    - Issue Comments
    - Review Comments/Bodies
    - _Rationale:_ Reactions often indicate community agreement, appreciation, or acknowledgment of value, which is hard to game directly at scale.

2.  **PR Impact Modifiers:**

    - **Issue Linkage Bonus:** Award bonus points for PRs that explicitly link to and close issues, with higher bonuses for critical types like `bug` or `feature`.
      - _Rationale:_ Directly rewards work that addresses documented needs or problems.
    - **Code Area Weighting:** Apply multipliers based on the `area` tags (from `config.tags.area`) associated with the files changed in a PR. Changes in more critical areas (`core`, `infra`) should yield higher scores.
      - _Rationale:_ Recognizes that changes in foundational code often have a broader impact.
    - **Trivial PR Mitigation:** Apply a penalty or significantly reduced score to very small PRs (e.g., < 10 lines changed) _unless_ they address a critical issue (e.g., labeled 'bug') or modify core files.
      - _Rationale:_ Discourages submitting numerous tiny, low-impact PRs solely for score inflation.
    - **PR Label Multipliers:** Allow specific labels (e.g., "high-impact", "security", "refactor") defined in the config to apply score multipliers to PRs.
      - _Rationale:_ Provides a manual way to flag and reward particularly important contributions.

3.  **Review Depth:** (Refinement)

    - While length is considered, add a small bonus if a review contains a minimum number of distinct comment threads (e.g., 3+).
      - _Rationale:_ Encourages more interaction points over a single long comment.

4.  **Negative Scoring (Future Consideration):**
    - _Idea:_ Penalties for reverted PRs, PRs causing build failures, or PRs directly linked to subsequent critical bug fixes.
    - _Status:_ Complex to implement reliably, keep as a future enhancement idea.

**II. Implementation Plan:**

1.  **Configuration (`config/pipeline.config.ts`):**

    - **Add `reactionScoring` section:**
      - Define points per reaction type (`thumbsUp`, `heart`, `hooray`, etc.).
      - Define contexts (e.g., `prDescription`, `issueComment`, `reviewComment`) with potential multipliers or separate point values.
    - **Enhance `pullRequest` scoring:**
      - Add `issueLinkBonus: { bug: number, feature: number, default: number }`.
      - Add `labelMultiplier: Record<string, number>` (e.g., `{ "high-impact": 1.5, "security": 2.0 }`).
      - Add `trivialPRThreshold: { lines: number, penaltyMultiplier: number }`.
      - _Keep_ `complexityMultiplier` but clarify its interaction with area weighting.
    - **Enhance `tags`:**
      - Ensure `area` tags have appropriate `weight` values to be used as multipliers/bonuses.
    - **Enhance `review` scoring:**
      - Add `minCommentThreadsBonus: { threshold: number, points: number }`.
    - **Review existing weights:** Adjust base points (e.g., for comments) potentially downwards if reaction scoring significantly increases scores.

2.  **Data Fetching (`src/lib/data/github.ts` & `src/lib/data/types.ts`):**

    - **Modify GraphQL Queries:** Update queries to fetch:
      - `reactions` field (including counts per type) for PRs, Issues, PR Comments, Issue Comments, Reviews.
      - `closingIssuesReferences` field for PRs (provides linked issue numbers/URLs).
      - `labels` for Issues (needed for issue linkage bonus).
    - **Update Zod Schemas (`types.ts`):** Add `reactions` and `closingIssuesReferences` fields to `RawPullRequestSchema`, `RawIssueSchema`, `RawCommentSchema`, `RawPRReviewSchema`. Add `labels` to `RawIssueSchema`.

3.  **Database Schema (`src/lib/data/schema.ts`):**

    - Likely **no changes needed** initially. Reaction counts and linked issues can be processed on-the-fly during scoring calculation. If performance becomes an issue or detailed reaction tracking is desired later, columns could be added to `raw_*` tables.

4.  **Query Layer (`src/lib/pipelines/contributors/queries.ts`):**

    - Update `getContributorPRs` to fetch the newly added fields (`reactions`, `closingIssuesReferences`, `labels` for the PR itself).
    - Update `getContributorIssueMetrics`, `getContributorReviewMetrics`, `getContributorCommentMetrics` to fetch necessary underlying data (e.g., individual comments/reviews with their reactions) if aggregation isn't done solely in the calculator.
    - _Potentially_ add a function `getIssuesDetails(repoId: string, issueNumbers: number[])` to fetch label information for issues linked in PRs, required for the `issueLinkBonus`.

5.  **Scoring Logic (`src/lib/scoring/scoreCalculator.ts`):**

    - **`calculatePRScore`:**
      - Incorporate reaction points for PR description based on `reactionScoring` config.
      - Implement Issue Linkage Bonus: Fetch linked issue details (labels) using `getIssuesDetails` (or ensure data is pre-fetched). Apply bonus based on config.
      - Implement Area Weighting: Iterate through `pr.files`. Match paths against `config.tags.area` patterns. Calculate a weighted bonus or multiplier based on the `weight` of matched areas. Add this to the score.
      - Implement Trivial PR Mitigation: Check line count and linked issues/labels. Apply penalty multiplier if conditions met.
      - Implement Label Multiplier: Check PR labels against `config.scoring.pullRequest.labelMultiplier`. Apply highest matching multiplier.
    - **`calculateIssueScore`:**
      - Incorporate reaction points for issue description.
    - **`calculateReviewScore`:**
      - Incorporate reaction points for review body/comments. (Need to ensure review comments are fetched with reactions).
      - Implement `minCommentThreadsBonus`.
    - **`calculateCommentScore`:**
      - Incorporate reaction points for the comment body.
    - **`calculateContributorScore`:**
      - Update function signature or internal logic to accept/fetch the required new data (reactions, linked issues).
      - Sum the new scoring components into the total score and potentially add new fields to the `ScoreResult.metrics` breakdown (e.g., `reactionScore`, `impactBonus`).

6.  **Storage (`src/lib/scoring/storage.ts` & `src/lib/scoring/types.ts`):**
    - Update `UserScoreMetricsSchema` in `types.ts` to include any new metric breakdowns added in `ScoreResult` (e.g., `reactionScore`, `impactBonus`).
    - Update `saveUserDailyScore` to store these new metrics in the `metrics` JSON blob if the schema was updated.

This plan prioritizes quantifiable metrics like reactions and code location while introducing mechanisms to handle impact and mitigate trivial contributions. We'll start by defining the configuration changes.
