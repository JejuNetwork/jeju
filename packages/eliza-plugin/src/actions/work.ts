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
import { getJejuService } from "../service";
import type { Hex, Address } from "viem";
import { parseEther } from "viem";

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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const title = (message.content as { title?: string }).title;
    const description = (message.content as { description?: string })
      .description;
    const rewardStr = (message.content as { reward?: string }).reward;
    const deadline = (message.content as { deadline?: number }).deadline;
    const tags = (message.content as { tags?: string[] }).tags;

    if (!title || !description || !rewardStr || !deadline) {
      callback({
        text: "Required: title, description, reward (ETH), deadline (unix timestamp)",
      });
      return;
    }

    const reward = parseEther(rewardStr);

    const result = await service.sdk.work.createBounty({
      title,
      description,
      reward,
      deadline,
      tags,
    });

    callback({
      text: `Bounty created!
ID: ${result.bountyId}
Reward: ${rewardStr} ETH
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const statusStr = (message.content as { status?: string }).status;
    const statusMap: Record<string, number> = {
      open: 0,
      in_progress: 1,
      review: 2,
      completed: 3,
      cancelled: 4,
      disputed: 5,
    };
    const status = statusStr ? statusMap[statusStr.toLowerCase()] : undefined;

    const bounties = await service.sdk.work.listBounties(status);

    if (bounties.length === 0) {
      callback({ text: "No bounties found" });
      return;
    }

    const list = bounties
      .map(
        (b, i) =>
          `${i + 1}. ${b.title} - ${b.reward} wei - ${b.tags.join(", ")}`,
      )
      .join("\n");

    callback({ text: `Bounties:\n${list}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const bountyId = (message.content as { bountyId?: string }).bountyId;

    if (!bountyId) {
      callback({ text: "Bounty ID required" });
      return;
    }

    const txHash = await service.sdk.work.claimBounty(bountyId as Hex);

    callback({ text: `Bounty claimed! Tx: ${txHash}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const bountyId = (message.content as { bountyId?: string }).bountyId;
    const content = (message.content as { workContent?: string }).workContent;
    const proofOfWork = (message.content as { proofOfWork?: string })
      .proofOfWork;

    if (!bountyId || !content || !proofOfWork) {
      callback({
        text: "Required: bountyId, workContent, proofOfWork (IPFS hash/URL)",
      });
      return;
    }

    const txHash = await service.sdk.work.submitWork({
      bountyId: bountyId as Hex,
      content,
      proofOfWork,
    });

    callback({ text: `Work submitted! Tx: ${txHash}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const submissionId = (message.content as { submissionId?: string })
      .submissionId;

    if (!submissionId) {
      callback({ text: "Submission ID required" });
      return;
    }

    const txHash = await service.sdk.work.approveSubmission(
      submissionId as Hex,
    );

    callback({ text: `Submission approved! Payment released. Tx: ${txHash}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const submissionId = (message.content as { submissionId?: string })
      .submissionId;
    const feedback = (message.content as { feedback?: string }).feedback;

    if (!submissionId || !feedback) {
      callback({ text: "Submission ID and feedback required" });
      return;
    }

    const txHash = await service.sdk.work.rejectSubmission(
      submissionId as Hex,
      feedback,
    );

    callback({ text: `Submission rejected. Tx: ${txHash}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const name = (message.content as { name?: string }).name;
    const description = (message.content as { description?: string })
      .description;
    const repository = (message.content as { repository?: string }).repository;
    const budgetStr = (message.content as { budget?: string }).budget;

    if (!name || !description) {
      callback({ text: "Required: name, description" });
      return;
    }

    const budget = budgetStr ? parseEther(budgetStr) : undefined;

    const result = await service.sdk.work.createProject({
      name,
      description,
      repository,
      budget,
    });

    callback({
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const mine = (message.content as { mine?: boolean }).mine;

    const projects = mine
      ? await service.sdk.work.listMyProjects()
      : await service.sdk.work.listProjects();

    if (projects.length === 0) {
      callback({ text: "No projects found" });
      return;
    }

    const list = projects
      .map(
        (p, i) =>
          `${i + 1}. ${p.name} - ${p.memberCount} members, ${p.bountyCount} bounties`,
      )
      .join("\n");

    callback({ text: `Projects:\n${list}` });
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
        content: { text: "Create task: Implement auth, 0.1 ETH, in project 0x..." },
      },
      {
        name: "assistant",
        content: { text: "Creating task..." },
      },
    ],
  ],
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const projectId = (message.content as { projectId?: string }).projectId;
    const title = (message.content as { title?: string }).title;
    const description = (message.content as { description?: string })
      .description;
    const rewardStr = (message.content as { reward?: string }).reward;
    const dueDate = (message.content as { dueDate?: number }).dueDate;

    if (!projectId || !title || !description || !rewardStr) {
      callback({
        text: "Required: projectId, title, description, reward (ETH)",
      });
      return;
    }

    const reward = parseEther(rewardStr);

    const txHash = await service.sdk.work.createTask(
      projectId as Hex,
      title,
      description,
      reward,
      dueDate,
    );

    callback({ text: `Task created! Tx: ${txHash}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const projectId = (message.content as { projectId?: string }).projectId;

    if (!projectId) {
      callback({ text: "Project ID required" });
      return;
    }

    const tasks = await service.sdk.work.getTasks(projectId as Hex);

    if (tasks.length === 0) {
      callback({ text: "No tasks in this project" });
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

    const list = tasks
      .map(
        (t, i) =>
          `${i + 1}. ${t.title} - ${t.reward} wei - ${statusNames[t.status]} - ${t.assignee || "Unassigned"}`,
      )
      .join("\n");

    callback({ text: `Tasks:\n${list}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const name = (message.content as { name?: string }).name;
    const stakeStr = (message.content as { stake?: string }).stake;

    if (!name || !stakeStr) {
      callback({ text: "Required: name, stake (ETH)" });
      return;
    }

    const stake = parseEther(stakeStr);

    const txHash = await service.sdk.work.registerAsGuardian(name, stake);

    callback({ text: `Registered as guardian! Tx: ${txHash}` });
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
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback: HandlerCallback,
  ) => {
    const service = getJejuService();

    const guardians = await service.sdk.work.listGuardians();

    if (guardians.length === 0) {
      callback({ text: "No active guardians" });
      return;
    }

    const list = guardians
      .map(
        (g, i) =>
          `${i + 1}. ${g.name} - ${g.stake} wei stake - ${g.reviewCount} reviews (${g.approvalRate}% approval)`,
      )
      .join("\n");

    callback({ text: `Active Guardians:\n${list}` });
  },
};

