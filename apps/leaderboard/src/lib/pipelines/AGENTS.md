# Agent & Pipeline Development Guide

This document outlines the architecture, conventions, and best practices for working with the data pipelines in this project. The goal is to maintain a clean, scalable, and maintainable data processing system.

## Overview

The pipelines module is responsible for fetching, processing, analyzing, and summarizing data from various sources (primarily GitHub). It is built on a functional, composable architecture, where complex workflows are constructed from small, reusable, and testable units called `PipelineStep`.

## Core Concepts

### 1. Pipelines and Steps

- **`PipelineStep`**: The fundamental building block. It's a function that takes an `input` and a `context` and returns an `output`. Steps are strongly typed and can be synchronous or asynchronous.
- **`createStep`**: A factory function for creating a `PipelineStep`. It wraps your transformation logic with logging and context management, making it easier to trace execution. **Always use this to define new steps.**
- **Composition Functions**:
  - **`pipe(...)`**: Chains steps together sequentially, where the output of one step becomes the input of the next.
  - **`parallel(...)`**: Executes multiple steps concurrently with the same input. It's useful for performing independent operations on the same data.
  - **`sequence(...)`**: Executes multiple steps sequentially with the same input. Useful when order matters but the steps don't depend on each other's output.
  - **`mapStep(...)`**: Applies a `PipelineStep` to each item in an array, running them in parallel with a configurable concurrency.

### 2. Context

- **`BasePipelineContext`**: An object that flows through every step in a pipeline. It holds shared resources and configuration.
- **Extended Contexts**: For specific types of pipelines, we create extended contexts (e.g., `IngestionPipelineContext`, `SummarizerPipelineContext`). These add specialized dependencies like a `GitHubClient` or AI configuration.
- **Dependency Injection**: The context acts as a form of dependency injection. Instead of importing clients or configs directly into a step, they should be accessed from the `context` object.

### 3. Configuration

- **`pipelineConfig.ts`**: This file defines the structure of all pipeline configurations using `zod` schemas. This provides runtime validation and static type safety.
- **Centralized Config**: All configuration, such as scoring weights, repository lists, and AI settings, is managed through a single `PipelineConfig` object passed in the context.

### 4. Time-based Processing with `generateTimeIntervals`

- **`generateTimeIntervals`**: A crucial step creator found in `generateTimeIntervals.ts`. It takes an `intervalType` ('day', 'week', 'month') and a date range from the context or configuration.
- **Chunking Data**: Its primary role is to break down a large date range into a series of smaller, discrete `TimeInterval` objects (e.g., an array of daily intervals for the last 7 days).
- **Incremental Processing**: Most pipelines begin with this step. The subsequent `mapStep` then iterates over these intervals, allowing data to be fetched, processed, or summarized for one small time period at a time. This is key to the system's efficiency, as it ensures we only process data that is new or needs updating, rather than re-processing the entire history on every run.

## Module Structure

The `pipelines` directory is organized into sub-modules, each representing a distinct stage of data processing.

- **/ingest**: Fetches raw data from external sources (e.g., GitHub API) and stores it in the database. It handles pagination, rate limiting, and data normalization.
- **/contributors**: Analyzes the raw data to calculate contributor-specific metrics. This includes calculating activity scores (`contributorScores.ts`) and assigning expertise tags (`calculateTags.ts`).
- **/export**: Generates aggregated repository-level statistics (e.g., for daily, weekly, monthly intervals) and saves them to files.
- **/summarize**: Uses an AI service to generate human-readable summaries of repository, overall, and contributor activity based on the processed metrics.

### Common File Conventions

Within each sub-module, you will typically find:

- `index.ts`: Assembles the final, high-level pipeline(s) for the module by composing smaller steps.
- `context.ts`: Defines the specialized context interface and a creator function for that module's pipelines.
- `queries.ts`: Contains all database **read** operations using Drizzle ORM.
- `mutations.ts`: Contains all database **write** operations (e.g., `insert`, `update`).
- Other `.ts` files: Implementations of individual `PipelineStep`s.

## Coding Practices & Conventions

1.  **Functional & Immutable**: Write steps as pure functions where possible. They receive data, transform it, and return new data, avoiding side effects on their inputs.
2.  **Separation of Concerns**:
    - **Logic vs. I/O**: Keep pipeline logic (data transformation) separate from I/O operations.
    - **Database**: All database access **must** be done through functions in `queries.ts` (for reads) and `mutations.ts` (for writes). Do not write raw Drizzle queries inside a pipeline step.
    - **Configuration**: Never hardcode values. Always source them from the `config` object in the context.
3.  **Small, Reusable Steps**: Break down complex operations into smaller, well-named steps. This improves readability, testability, and reusability. Use `createStep` for every new piece of logic.
4.  **Use the Context**: Pass dependencies like loggers, API clients, and configuration via the `context` object. Avoid global state or direct imports of these resources within steps.
5.  **Logging**: Use the logger from the context (`context.logger?.info(...)`). The `createStep` function automatically creates a child logger for each step, providing structured and traceable logs.
6.  **Asynchronous Operations**: Pipelines are inherently asynchronous. Use `async/await` and `Promise.all` correctly. The `parallel` and `mapStep` helpers manage concurrency for you.
7.  **Error Handling**: The main `runPipeline` function has a top-level `try/catch` block. For more granular error handling (e.g., to allow parts of a pipeline to fail without stopping the whole process), use `try/catch` within a specific `PipelineStep`.
