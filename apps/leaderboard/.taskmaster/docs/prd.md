# Product Requirements Document: Eliza Leaderboard

<context>
# Overview
The Eliza Leaderboard is a modern analytics pipeline designed to track, analyze, and visualize GitHub contributions for specified repositories, primarily focusing on the ElizaOS ecosystem. It solves the problem of quantifying and understanding developer activity and impact within open-source projects by processing various GitHub events (PRs, issues, reviews, comments), calculating contributor scores based on configurable rules, generating AI-powered summaries, and presenting the data through a web interface (leaderboard, profiles). The long-term vision includes integrating Web3 capabilities to directly reward contributors and enable new funding models based on this on-chain and off-chain data.

It's primarily for developers, team leads, and project managers involved in or observing the ElizaOS project (or other configured repositories) who need insights into contribution patterns, individual performance, and overall project health. The value lies in providing objective metrics, recognizing contributor efforts, identifying expertise areas, offering concise summaries of development activity over time, and eventually bridging these contributions to on-chain value and rewards.

# Core Features

- **GitHub Data Ingestion:**
  - _What it does:_ Fetches pull requests, issues, reviews, and comments from configured GitHub repositories using the GitHub GraphQL API.
  - _Why it's important:_ Provides the raw data foundation for all subsequent analysis and reporting.
  - _How it works:_ The `ingest` pipeline command connects to the GitHub API using a provided token, queries for relevant events within a specified date range (or since the last fetch), and stores the raw data in a local SQLite database. Configurable to ignore specified bot users.
- **Configurable Contributor Scoring:**
  - _What it does:_ Calculates scores for contributors based on their activity (PRs created/merged, issues opened/closed, reviews performed, comments made) and impact (code changes, complexity, review feedback).
  - _Why it's important:_ Provides a quantitative measure of contribution (XP/score), allowing for ranking, skill tracking, and trend analysis. Encourages high-value activities.
  - _How it works:_ A dedicated scoring pipeline (or stage within `process`) uses `TagRule` definitions stored in `config/pipeline.config.ts` . Each `TagRule` contains `TagPattern`s that specify matching criteria (e.g., file paths, commit messages, event types) and the corresponding points (XP) awarded upon matching. The system calculates cumulative scores per user per tag rule, applying logic like multipliers, decay, or caps if configured. Scores are stored/updated in the `userTagScores` database table.
- **Activity Tagging and Expertise Analysis:**
  - _What it does:_ Tags contributions based on affected code areas (e.g., `core`, `ui`, `docs`, `infra`, `tests`) and infers contributor roles (e.g., `architect`, `maintainer`, `feature-dev`) and technical expertise (e.g., `typescript`, `react`, `database`) using pattern matching defined in the configuration.
  - _Why it's important:_ Helps identify domain experts, understand where development effort is focused, and drives the scoring system.
  - _How it works:_ During the scoring pipeline step, various content types (file paths, commit messages, PR titles, issue bodies, comments, labels, reactions) associated with contributions are matched against patterns defined within `TagRule`s (`config/pipeline.config.ts` or `tagRules` table). Matching a pattern contributes points towards the user's score for that specific `TagRule` (representing a skill, area, or technology) and helps categorize the contribution.
- **Data Export:**
  - _What it does:_ Exports processed statistics and scores into structured JSON files for different time intervals (daily, weekly, monthly).
  - _Why it's important:_ Makes the processed data available for external use, archival, or integration with other systems. Provides the data source for the frontend.
  - _How it works:_ The `export` pipeline command queries the database for processed data within a specified date range and generates JSON files organized by repository and time interval (e.g., `data/elizaos_eliza/day/stats/stats_2024-01-01.json`).
- **AI-Powered Summaries:**
  - _What it does:_ Generates natural language summaries of project activity and individual contributor efforts for daily, weekly, and monthly periods.
  - _Why it's important:_ Provides concise, human-readable overviews of progress and contributions, saving time compared to reviewing raw data.
  - _How it works:_ The `summarize` pipeline command (with `-t repository`, `-t overall`, or `-t contributors` flags) sends relevant processed data (PR titles, issue summaries, key stats) to an AI model (configurable via OpenRouter) using prompts tailored for repository, overall, or contributor summaries. The generated summaries are saved as JSON files (e.g., `data/elizaos_eliza/week/summaries/summary_2024-W01.json`). Specific models can be configured per interval.
- **Web Interface (Leaderboard & Profiles):**
  - _What it does:_ Provides an interactive web frontend built with Next.js to display the leaderboard, contributor profiles, daily/weekly/monthly reports, and activity visualizations.
  - _Why it's important:_ Makes the analytics accessible and engaging for users.
  - _How it works:_ The Next.js application (`src/app`) reads the exported JSON data (stats and summaries). It includes pages for a general leaderboard (`/leaderboard`), individual contributor profiles (`/profile/[username]`), and potentially daily views (`/daily/[[...date]]`). Uses shadcn/ui for components. The site is statically generated via `bun run build`.
- **Database Management & Migration:**
  - _What it does:_ Uses SQLite for local data storage and Drizzle ORM for schema definition, type safety, and migrations. Includes tools for database initialization, migration generation (`db:generate`), migration application (`db:migrate`), and exploration (`db:studio`).
  - _Why it's important:_ Ensures reliable data storage, allows schema evolution, and provides developer tools for database interaction.
  - _How it works:_ Schema is defined in `src/lib/data/schema.ts`. Drizzle Kit commands manage migrations stored in the `drizzle/` folder. The database file resides at `data/db.sqlite`.
- **Automated CI/CD Workflow:**
  - _What it does:_ Automates the data pipeline execution (ingest, process, export, summarize) and website deployment using GitHub Actions.
  - _Why it's important:_ Ensures data is kept up-to-date automatically and the website reflects the latest analytics.
  - _How it works:_ The `run-pipelines.yml` workflow runs daily (or manually) executing the pipeline commands (`bun run pipeline ...`). It uses a separate `_data` branch to store historical data and the database dump (using `sqlite-diffable` via custom actions `restore-db` and `pipeline-data`) to keep the main branch clean. The `deploy.yml` workflow builds the Next.js site (restoring data from `_data`) and deploys it to GitHub Pages. `pr-checks.yml` ensures code quality.
- **Data Synchronization Utility:**
  - _What it does:_ Allows developers to sync their local environment with the production data stored in the `_data` branch.
  - _Why it's important:_ Facilitates local development and testing by providing access to realistic, up-to-date data without needing to re-run the entire ingestion pipeline.
  - _How it works:_ The `bun run data:sync` command (using `uv` and custom scripts) fetches the latest `_data` branch, copies data files, and restores the SQLite database from the diffable dump.

# User Experience

- **User Personas:**
  - _Developers:_ Interested in tracking their own contributions, scores, and expertise areas relative to others. Use it to understand project activity.
  - _Team Leads/Maintainers:_ Monitor team activity, identify key contributors, understand workload distribution across different project areas, review AI summaries for quick updates.
  - _Project Managers/Community Managers:_ Track overall project velocity, identify contribution trends, highlight top contributors, understand project health from an activity perspective.
  - _Funders/DAO Members (Future):_ Allocate funds to specific features or areas and track contributor impact to inform reward distribution.
- **Key User Flows:**
  - _Viewing Leaderboard:_ User navigates to the main leaderboard page to see ranked contributors based on score for a selected period (e.g., weekly, monthly, all-time).
  - _Exploring Contributor Profile:_ User clicks on a contributor's name on the leaderboard (or navigates directly) to view their detailed profile, including score breakdown, activity timeline, recognized expertise tags, and historical contribution summaries.
  - _Viewing Periodical Reports:_ User navigates to specific daily, weekly, or monthly views to see aggregated stats and AI-generated summaries for the entire project during that period.
  - _Connecting Wallet (Future):_ User connects their Solana or Ethereum wallet to their profile to become eligible for on-chain rewards and participate in funding/raid features.
  - _Claiming Rewards (Future):_ Eligible contributors claim earned NFT badges or token airdrops via the frontend interface, triggering on-chain transactions.
  - _Funding Features (Future):_ Community members or funders browse features/areas and contribute funds (e.g., USDC) to specific development goals via smart contracts.
  - _Creating/Joining Raids (Future):_ Contributors group related PRs/issues into a "raid," define member splits, and potentially link it to funded goals for automated reward distribution upon completion.
- **UI/UX Considerations:** - _Interface:_ Clean, modern web interface using Next.js and shadcn/ui components. - _Data Visualization:_ Incorporate charts and graphs to visualize contribution trends, score breakdowns, and activity over time (specific visualizations TBD). - _Responsiveness:_ Ensure the interface is usable on different screen sizes. - _Performance:_ Optimize data loading and rendering, especially for profiles with long histories or leaderboards with many contributors. Static site generation helps with initial load performance. - _Clarity:_ Clearly explain how scores are calculated and what different metrics represent. Provide clear guidance and feedback for Web3 interactions (wallet connection, transactions, reward status).
  </context>

<PRD>
- **Technical Architecture**
- **System Components:**
    - *CLI Pipeline:* TypeScript application run with Bun (`cli/analyze-pipeline.ts`). Includes distinct pipeline steps/commands for data ingestion (`ingest`), scoring calculation (`score` or integrated into `process`), data export (`export`), and AI summarization (`summarize`).
    - *Web Frontend:* Next.js 14+ application (`src/app`) using App Router for displaying data. Statically exported for deployment (`out/`).
    - *Database:* SQLite (`data/db.sqlite`).
    - *ORM:* Drizzle ORM for database interaction and migrations (`src/lib/data/db.ts`, `src/lib/data/schema.ts`, `drizzle/`).
    - *CI/CD:* GitHub Actions (`.github/workflows/`).
    - *Configuration:* TypeScript-based configuration file (`config/pipeline.config.ts`). Defines repositories, bot users, AI settings, and importantly, the `TagRule` definitions (including patterns with embedded scoring logic), not stored dynamically in the database.
    - *Data Storage Branch:* Dedicated Git branch (`_data`) for storing exported JSON/MD data and SQLite database dump.
- **Data Models (High-Level based on Schema/Processing):**
    - *Repositories:* Information about tracked repositories.
    - *Contributors:* GitHub user information, calculated scores, expertise tags, linked wallet addresses .
    - *PullRequests:* Details fetched from GitHub (author, status, dates, files changed, associated reviews/comments/reactions/closing issues), potentially linked to Raids (future).
    - *Issues:* Details fetched from GitHub (author, status, dates, labels, associated comments/reactions), potentially linked to Raids (future).
    - *Reviews:* Details fetched from GitHub (reviewer, state, submission date).
    - *Comments:* Details fetched from GitHub (author, creation date, associated PR/Issue, reactions).
    - *Reactions:* Details fetched from GitHub (user, content, creation date, associated item).
    - *TagRules:* Definitions of skills/areas/tech, including patterns and scoring logic (points, multipliers, etc.). Stored in config
    - *UserTagScores:* Stores the cumulative XP/score per user per `TagRule`. Includes fields like `cumulativeScore`, `lastScoredEventTimestamp`, potentially level/progress info derived from score.
    - *Summaries:* AI-generated text summaries per project/contributor per time interval.
    - *Stats:* Aggregated statistics per repository per time interval (potentially deprecated or refocused if scoring covers main metrics).
- **APIs and Integrations:**
    - *GitHub GraphQL API:* Primary source for contribution data ingestion. Requires `GITHUB_TOKEN`.
    - *OpenRouter API:* Used for generating AI summaries. Requires `OPENROUTER_API_KEY`. Endpoint and models are configurable.
    - *Solana/Ethereum RPC Nodes (Future):* To interact with blockchains for wallet connections, transactions, and reading contract state.
    - *Web3 Libraries (Future):* e.g., viem, wagmi, connectkit, @solana/web3.js for frontend interactions.
    - *Smart Contracts (Future):* Deployed contracts on Solana/Ethereum for managing rewards, funding pools, and potentially raid logic.
    - *Blockchain Indexers (Optional, Future):* Services like The Graph or custom indexers to efficiently query on-chain data related to rewards/funding/raids.
- **Infrastructure Requirements:**
    - *Runtime:* Bun (recommended) or Node.js 18+.
    - *CI/CD Environment:* GitHub Actions runners (Ubuntu).
    - *Optional Tools:* `uv` (for `data:sync`), to run `sqlite-diffable` (used internally by CI/CD actions).
    - *Blockchain Nodes/Services (Future):* Access to reliable Solana and Ethereum RPC endpoints.

# Development Roadmap

- **MVP (Current State):**
  - Core pipeline functionality: Ingest, Process, Export, Summarize (Repository, Overall, & Contributor).
  - Configurable scoring rules and repository tracking.
  - SQLite database with Drizzle ORM and migrations.
  - Basic Next.js frontend displaying leaderboard and rudimentary profile/daily views based on exported JSONs.
  - Automated daily pipeline runs via GitHub Actions.
  - Separate `_data` branch management for data persistence.
  - Data synchronization utility (`data:sync`).
- **Future Enhancements (Potential):**
  - _Advanced Visualizations:_ Integrate charting libraries (e.g., Recharts, Nivo) for richer data display on the frontend (trends, breakdowns).
  - _Deeper AI Insights:_ Explore more sophisticated AI analysis (e.g., identifying contribution patterns, predicting potential issues, suggesting relevant reviewers).
  - _Trend Analysis:_ Implement features to compare activity across different time periods.
  - _Custom Reporting:_ Allow users to generate reports with custom date ranges or filters directly from the UI.
  - _Real-time Updates:_ Investigate options for more frequent or near real-time data updates (potentially using webhooks, though this increases complexity significantly).
  - _Enhanced Filtering/Sorting:_ Add more options for filtering and sorting the leaderboard and activity views.
- _Scoring Algorithm Refinements:_ Allow easier tuning and experimentation with scoring parameters, possibly via UI.
- _Detailed Score Logging:_ Add an optional database table to log individual scoring events (which event triggered which rule for how many points) for auditability and debugging.
- _Generating videos with Remotion:_ Explore generating summaries and visualizations and programatic videos with remotion
- **Web3 Integration:**
  - _Wallet Linking:_ Allow contributors to link Solana and Ethereum wallets to their profiles.
    - _On-Chain Rewards:_ Implement systems for awarding NFT badges and/or token airdrops based on contribution scores, specific achievements, or participation in raids.
    - _Community Funding:_ Develop smart contracts enabling community members/funders to allocate funds towards specific features, code areas, or bounties.
    - _Analytics-Driven Distribution:_ Use the existing contribution analytics (scores, tagged areas, file contributions) to automatically determine and distribute funded rewards to the relevant contributors for completed work.
    - _Contributor Raids:_ Implement functionality for contributors to self-organize PRs/issues into on-chain "projects" or "raids," define participants, agree on reward splits, and potentially link to funding pools.

# Logical Dependency Chain (Reflecting Current Build Order)

1.  **Foundation:**
    - Define core data structures/types (`src/lib/data/types.ts`).
    - Set up database schema (`src/lib/data/schema.ts`) and ORM (`src/lib/data/db.ts`).
    - Implement GitHub API interaction (`src/lib/data/github.ts`).
    - Build the core ingestion logic (`src/lib/pipelines/ingest`).
2.  **Processing & Scoring:**
    - Develop the scoring engine based on configurable rules (`src/lib/pipelines/contributors`, `config/pipeline.config.ts`).
    - Implement the data processing pipeline step (`src/lib/pipelines/contributors`).
3.  **Output & Basic Visibility:**
    - Create the export pipeline step to generate JSON stats (`src/lib/pipelines/export`).
    - Develop the CLI interface (`cli/analyze-pipeline.ts`) to run individual pipeline steps.
4.  **Frontend Implementation:**
    - Set up the Next.js application (`src/app`).
    - Build basic pages for leaderboard, profiles, and daily views, consuming exported JSON data.
5.  **Advanced Features & Automation:**
    - Implement AI summary generation (`src/lib/pipelines/summarize`).
    - Develop CI/CD workflows (`.github/workflows/`) for automation.
    - Create data management strategy (`_data` branch, custom actions).
    - Build data synchronization utility (`data:sync` script).

# Risks and Mitigations

- **GitHub API Changes/Rate Limits:**
  - _Risk:_ GitHub may change its API or enforce stricter rate limits, breaking ingestion.
  - _Mitigation:_ Use official GraphQL API, handle errors gracefully, implement request batching/caching where possible, stay informed about API updates, manage token usage carefully.
- **AI API Costs & Reliability:**
  - _Risk:_ AI summary generation can be expensive or the API might be unavailable.
  - _Mitigation:_ Monitor API costs, make AI summaries optional via config (`aiSummary.enabled`), implement retries for API calls, allow configuration of cheaper/different models (`aiSummary.models`), potentially add circuit breaking.
- **Data Volume & Scalability (SQLite):**
  - _Risk:_ SQLite performance might degrade with very large datasets or high concurrency needs (though concurrency is low for this use case). The single DB file can become large.
  - _Mitigation:_ Optimize database queries and indexing. Implement data archiving/pruning strategies if necessary. Use `sqlite-diffable` for efficient Git storage. Plan for potential migration to a server-based database if scale demands it.
- **Accuracy/Fairness of Scoring:**
  - _Risk:_ The scoring algorithm might not accurately reflect the desired contribution value or could be perceived as unfair.
  - _Mitigation:_ Make scoring highly configurable (`config/pipeline.config.ts`). Document the scoring logic clearly. Regularly review and tune the algorithm based on feedback and observed results. Solicit community input on scoring weights.
- **Data Consistency (`_data` Branch):**
  - _Risk:_ Errors in CI/CD or manual manipulation could lead to inconsistencies between the main codebase and the data branch.
  - _Mitigation:_ Implement robust error handling and logging in CI/CD custom actions (`restore-db`, `pipeline-data`). Clearly document the data management workflow. Use atomic operations where possible when updating the data branch. Regularly validate data integrity.
- **Dependency Updates:**
  - _Risk:_ Updates to key dependencies (Bun, Next.js, Drizzle, etc.) could introduce breaking changes.
  - _Mitigation:_ Use lockfiles (`bun.lockb`). Implement CI checks (`pr-checks.yml`) that include dependency installation and build steps. Update dependencies incrementally and test thoroughly.
- **Web3/Smart Contract Risks (Future):**
  - _Risk:_ Bugs in smart contracts could lead to loss of funds or incorrect reward distribution. Wallet connection introduces new security considerations for users. Blockchain transaction fees (gas) could be prohibitive. Network congestion or outages could affect usability.
  - _Mitigation:_ Rigorous smart contract auditing by reputable third parties. Clear communication about wallet security best practices. Design contracts to minimize gas costs. Implement robust error handling for blockchain interactions. Consider L2 solutions or alternative chains if gas fees are a major issue. Allow graceful degradation if blockchain interactions fail.

# Appendix

- **Project README:** [README.md](README.md)
- **Pipeline Configuration:** [config/pipeline.config.ts](config/pipeline.config.ts)
- **Pipeline Cron Job:** [.github/workflows/run-pipelines.yml](.github/workflows/run-pipelines.yml)
- **CI/CD:** [.github/workflows/pr-checks.yml](.github/workflows/pr-checks.yml) and [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Database Schema:** (Located at `src/lib/data/schema.ts`)
  </PRD>
