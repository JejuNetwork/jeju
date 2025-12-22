/**
 * Work Actions for Eliza Plugin
 *
 * Bounties, projects, and developer coordination
 */

import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import type { Hex } from "viem";
import { parseEther } from "viem";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";
import {
  validateServiceExists,
  parseContent,
  bountyContentSchema,
  bountyIdSchema,
  workSubmissionSchema,
  submissionActionSchema,
  projectContentSchema,
  taskContentSchema,
  guardianContentSchema,
  formatNumberedList,
} from "../validation";

// ═══════════════════════════════════════════════════════════════════════════
//                          BOUNTY ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const createBountyAction: Action = {
  name: "CREATE_BOUNTY",
  description: "Create a new bounty with ETH reward",
  similes: ["post bounty", "new bounty", "offer reward"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Create bounty: Fix login bug, 0.5 ETH reward, deadline Jan 1",
        },
      },
      {
        name: "assistant",
        content: { text: "Creating bounty with 0.5 ETH reward..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, bountyContentSchema);

    if (
      !content.title ||
      !content.description ||
      !content.reward ||
      !content.deadline
    ) {
      callback?.({
        text: "Required: title, description, reward (ETH), deadline (unix timestamp)",
      });
      return;
    }

    const reward = parseEther(content.reward);

    const result = await sdk.work.createBounty({
      title: content.title,
      description: content.description,
      reward,
      deadline: content.deadline,
      tags: content.tags,
    });

    callback?.({
      text: `Bounty created!
ID: ${result.bountyId}
Reward: ${content.reward} ETH
Tx: ${result.txHash}`,
    });
  },
};

export const listBountiesAction: Action = {
  name: "LIST_BOUNTIES",
  description: "List available bounties",
  similes: ["show bounties", "open bounties", "available work"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Show me open bounties" },
      },
      {
        name: "assistant",
        content: { text: "Listing open bounties..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, bountyContentSchema);
    const statusMap: Record<string, number> = {
      open: 0,
      in_progress: 1,
      review: 2,
      completed: 3,
      cancelled: 4,
      disputed: 5,
    };

    // Extract status from text if provided
    const text = content.text ?? "";
    const statusMatch = text
      .toLowerCase()
      .match(/(open|in_progress|review|completed|cancelled|disputed)/);
    const status = statusMatch ? statusMap[statusMatch[1]] : undefined;

    const bounties = await sdk.work.listBounties(status);

    if (bounties.length === 0) {
      callback?.({ text: "No bounties found" });
      return;
    }

    const list = formatNumberedList(
      bounties,
      (b: { title: string; reward: bigint | string; tags: string[] }) =>
        `${b.title} - ${b.reward} wei - ${b.tags.join(", ")}`,
    );

    callback?.({ text: `Bounties:\n${list}` });
  },
};

export const claimBountyAction: Action = {
  name: "CLAIM_BOUNTY",
  description: "Claim a bounty to work on it",
  similes: ["take bounty", "work on bounty", "accept bounty"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Claim bounty 0x123..." },
      },
      {
        name: "assistant",
        content: { text: "Claiming bounty..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, bountyIdSchema);

    if (!content.bountyId) {
      callback?.({ text: "Bounty ID required" });
      return;
    }

    const txHash = await sdk.work.claimBounty(content.bountyId as Hex);

    callback?.({ text: `Bounty claimed! Tx: ${txHash}` });
  },
};

export const submitWorkAction: Action = {
  name: "SUBMIT_BOUNTY_WORK",
  description: "Submit work for a claimed bounty",
  similes: ["submit solution", "deliver work", "complete bounty"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Submit work for bounty 0x123... with proof at ipfs://Qm...",
        },
      },
      {
        name: "assistant",
        content: { text: "Submitting work..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, workSubmissionSchema);

    if (!content.bountyId || !content.workContent || !content.proofOfWork) {
      callback?.({
        text: "Required: bountyId, workContent, proofOfWork (IPFS hash/URL)",
      });
      return;
    }

    const txHash = await sdk.work.submitWork({
      bountyId: content.bountyId as Hex,
      content: content.workContent,
      proofOfWork: content.proofOfWork,
    });

    callback?.({ text: `Work submitted! Tx: ${txHash}` });
  },
};

export const approveSubmissionAction: Action = {
  name: "APPROVE_SUBMISSION",
  description: "Approve a bounty submission and release payment",
  similes: ["accept work", "approve solution", "pay bounty"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Approve submission 0xabc..." },
      },
      {
        name: "assistant",
        content: { text: "Approving submission..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, submissionActionSchema);

    if (!content.submissionId) {
      callback?.({ text: "Submission ID required" });
      return;
    }

    const txHash = await sdk.work.approveSubmission(
      content.submissionId as Hex,
    );

    callback?.({
      text: `Submission approved! Payment released. Tx: ${txHash}`,
    });
  },
};

export const rejectSubmissionAction: Action = {
  name: "REJECT_SUBMISSION",
  description: "Reject a bounty submission with feedback",
  similes: ["decline work", "reject solution"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Reject submission 0xabc... - needs more testing" },
      },
      {
        name: "assistant",
        content: { text: "Rejecting submission..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, submissionActionSchema);

    if (!content.submissionId || !content.feedback) {
      callback?.({ text: "Submission ID and feedback required" });
      return;
    }

    const txHash = await sdk.work.rejectSubmission(
      content.submissionId as Hex,
      content.feedback,
    );

    callback?.({ text: `Submission rejected. Tx: ${txHash}` });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//                          PROJECT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const createProjectAction: Action = {
  name: "CREATE_PROJECT",
  description: "Create a new project for coordinating work",
  similes: ["new project", "start project", "create workspace"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Create project: DeFi Dashboard, with repo github.com/...",
        },
      },
      {
        name: "assistant",
        content: { text: "Creating project..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, projectContentSchema);

    if (!content.name || !content.description) {
      callback?.({ text: "Required: name, description" });
      return;
    }

    const budget = content.budget ? parseEther(content.budget) : undefined;

    const result = await sdk.work.createProject({
      name: content.name,
      description: content.description,
      repository: content.repository,
      budget,
    });

    callback?.({
      text: `Project created!
ID: ${result.projectId}
Tx: ${result.txHash}`,
    });
  },
};

export const listProjectsAction: Action = {
  name: "LIST_PROJECTS",
  description: "List all projects",
  similes: ["show projects", "my projects", "all projects"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Show me all projects" },
      },
      {
        name: "assistant",
        content: { text: "Listing projects..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, projectContentSchema);

    const projects = content.mine
      ? await sdk.work.listMyProjects()
      : await sdk.work.listProjects();

    if (projects.length === 0) {
      callback?.({ text: "No projects found" });
      return;
    }

    const list = formatNumberedList(
      projects,
      (p: { name: string; memberCount: number; bountyCount: number }) =>
        `${p.name} - ${p.memberCount} members, ${p.bountyCount} bounties`,
    );

    callback?.({ text: `Projects:\n${list}` });
  },
};

export const createTaskAction: Action = {
  name: "CREATE_PROJECT_TASK",
  description: "Create a task within a project",
  similes: ["add task", "new task", "create ticket"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Create task: Implement auth, 0.1 ETH, in project 0x...",
        },
      },
      {
        name: "assistant",
        content: { text: "Creating task..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, taskContentSchema);

    if (
      !content.projectId ||
      !content.title ||
      !content.description ||
      !content.reward
    ) {
      callback?.({
        text: "Required: projectId, title, description, reward (ETH)",
      });
      return;
    }

    const reward = parseEther(content.reward);

    const txHash = await sdk.work.createTask(
      content.projectId as Hex,
      content.title,
      content.description,
      reward,
      content.dueDate,
    );

    callback?.({ text: `Task created! Tx: ${txHash}` });
  },
};

export const getTasksAction: Action = {
  name: "GET_PROJECT_TASKS",
  description: "List tasks in a project",
  similes: ["project tasks", "show tasks", "task list"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Show tasks for project 0x123..." },
      },
      {
        name: "assistant",
        content: { text: "Listing project tasks..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, taskContentSchema);

    if (!content.projectId) {
      callback?.({ text: "Project ID required" });
      return;
    }

    const tasks = await sdk.work.getTasks(content.projectId as Hex);

    if (tasks.length === 0) {
      callback?.({ text: "No tasks in this project" });
      return;
    }

    const statusNames = [
      "OPEN",
      "IN_PROGRESS",
      "REVIEW",
      "COMPLETED",
      "CANCELLED",
      "DISPUTED",
    ];

    const list = formatNumberedList(
      tasks,
      (t: {
        title: string;
        reward: bigint | string;
        status: number;
        assignee?: string;
      }) =>
        `${t.title} - ${t.reward} wei - ${statusNames[t.status]} - ${t.assignee ?? "Unassigned"}`,
    );

    callback?.({ text: `Tasks:\n${list}` });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//                          GUARDIAN ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const registerGuardianAction: Action = {
  name: "REGISTER_GUARDIAN",
  description: "Register as a guardian to review bounty submissions",
  similes: ["become guardian", "join guardians", "register reviewer"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Register as guardian with 1 ETH stake" },
      },
      {
        name: "assistant",
        content: { text: "Registering as guardian..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const content = parseContent(message, guardianContentSchema);

    if (!content.name || !content.stake) {
      callback?.({ text: "Required: name, stake (ETH)" });
      return;
    }

    const stake = parseEther(content.stake);

    const txHash = await sdk.work.registerAsGuardian(content.name, stake);

    callback?.({ text: `Registered as guardian! Tx: ${txHash}` });
  },
};

export const listGuardiansAction: Action = {
  name: "LIST_GUARDIANS",
  description: "List active guardians",
  similes: ["show guardians", "active guardians", "reviewers"],
  examples: [
    [
      {
        name: "user",
        content: { text: "Show me active guardians" },
      },
      {
        name: "assistant",
        content: { text: "Listing guardians..." },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime) => validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService;
    const sdk = service.getClient();

    const guardians = await sdk.work.listGuardians();

    if (guardians.length === 0) {
      callback?.({ text: "No active guardians" });
      return;
    }

    const list = formatNumberedList(
      guardians,
      (g: {
        name: string;
        stake: bigint | string;
        reviewCount: number;
        approvalRate: number;
      }) =>
        `${g.name} - ${g.stake} wei stake - ${g.reviewCount} reviews (${g.approvalRate}% approval)`,
    );

    callback?.({ text: `Active Guardians:\n${list}` });
  },
};
