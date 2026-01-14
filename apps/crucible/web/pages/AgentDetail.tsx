import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { API_URL, getIpfsUrl } from "../config";
import {
  useAgent,
  useAgentActivity,
  useAgentBalance,
  useFundVault,
  useRooms,
  useTriggerAgentTick,
} from "../hooks";
import { getBotTypeConfig } from "../lib/constants";
import { formatDistanceToNow } from "../lib/utils";

function useToggleAutonomous() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentId,
      enabled,
      watchRoom,
      postToRoom,
    }: {
      agentId: string;
      enabled: boolean;
      watchRoom?: string;
      postToRoom?: string;
    }) => {
      const response = await fetch(
        `${API_URL}/api/v1/agents/${agentId}/autonomous`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled, watchRoom, postToRoom }),
        },
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error ?? "Failed to toggle autonomous mode");
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agent", variables.agentId] });
    },
  });
}

const CAPABILITY_CONFIG: Record<
  string,
  { icon: string; label: string; description: string }
> = {
  canChat: {
    icon: "💬",
    label: "Chat",
    description: "Can participate in conversations",
  },
  canTrade: {
    icon: "📈",
    label: "Trade",
    description: "Can execute trades on DEXes",
  },
  canVote: { icon: "🗳️", label: "Vote", description: "Can vote on proposals" },
  canPropose: {
    icon: "📝",
    label: "Propose",
    description: "Can create proposals",
  },
  canStake: { icon: "🔒", label: "Stake", description: "Can stake tokens" },
  a2a: {
    icon: "🤝",
    label: "A2A",
    description: "Can communicate with other agents",
  },
  compute: { icon: "🧮", label: "Compute", description: "Can use DWS compute" },
};

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, error } = useAgent(id ?? "");
  const { data: balance } = useAgentBalance(id ?? "");
  const { data: agentActivity, isLoading: isActivityLoading } =
    useAgentActivity(id ?? "");
  const triggerTick = useTriggerAgentTick();
  const fundVault = useFundVault();
  const toggleAutonomous = useToggleAutonomous();
  const { data: roomsData } = useRooms({ limit: 50 });
  const [showFundModal, setShowFundModal] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [activeTab, setActiveTab] = useState<
    "overview" | "actions" | "settings"
  >("overview");
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(
    new Set(),
  );
  const [autonomousRooms, setAutonomousRooms] = useState({
    watchRoom: "",
    postToRoom: "",
  });

  const toggleActivityExpanded = (key: string) => {
    setExpandedActivities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const formatActivityTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatResult = (result: unknown): string => {
    if (!result) return "";
    if (typeof result === "string") return result.slice(0, 80);
    if (typeof result === "object" && result !== null) {
      const obj = result as Record<string, unknown>;
      if ("error" in obj) return String(obj.error).slice(0, 80);
      if ("text" in obj) return String(obj.text).slice(0, 80);
      if ("message" in obj) return String(obj.message).slice(0, 80);
      return JSON.stringify(result).slice(0, 80);
    }
    return String(result).slice(0, 80);
  };

  const getFullResult = (result: unknown): string => {
    if (!result) return "";
    if (typeof result === "string") return result;
    return JSON.stringify(result, null, 2);
  };

  const handleExecute = async () => {
    if (!id || !agent) return;
    try {
      // Always trigger a single tick for on-chain agents
      const result = await triggerTick.mutateAsync(id);
      if (result.success) {
        toast.success("Agent executed");
      } else {
        const error = result.results[0]?.error ?? "Unknown error";
        toast.error(`Execution failed: ${error}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execution failed");
    }
  };

  const handleFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !fundAmount) return;
    try {
      const amountWei = (Number(fundAmount) * 1e18).toString();
      await fundVault.mutateAsync({ agentId: id, amount: amountWei });
      toast.success("Vault funded");
      setShowFundModal(false);
      setFundAmount("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Funding failed");
    }
  };

  const handleToggleAutonomous = async () => {
    if (!id || !agent) return;
    const isCurrentlyAutonomous =
      agent.tickIntervalMs && agent.tickIntervalMs > 0;
    const watchRoom = autonomousRooms.watchRoom.trim();
    const postToRoom = autonomousRooms.postToRoom.trim();
    try {
      await toggleAutonomous.mutateAsync({
        agentId: id,
        enabled: !isCurrentlyAutonomous,
        watchRoom: !isCurrentlyAutonomous && watchRoom ? watchRoom : undefined,
        postToRoom: !isCurrentlyAutonomous && postToRoom ? postToRoom : undefined,
      });
      toast.success(
        isCurrentlyAutonomous
          ? "Autonomous mode disabled"
          : "Autonomous mode enabled",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to toggle autonomous mode",
      );
    }
  };

  if (isLoading) {
    return (
      <output className="flex flex-col items-center justify-center py-20">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm" style={{ color: "var(--text-tertiary)" }}>
          Loading agent
        </p>
      </output>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <div className="text-6xl mb-6" role="img" aria-label="Error">
          ⚠️
        </div>
        <h1
          className="text-2xl font-bold mb-3 font-display"
          style={{ color: "var(--color-error)" }}
        >
          Agent not found
        </h1>
        <p className="mb-6" style={{ color: "var(--text-secondary)" }}>
          {error?.message ??
            "The agent may have been removed or the ID is invalid."}
        </p>
        <Link to="/agents" className="btn-secondary">
          ← Back to Agents
        </Link>
      </div>
    );
  }

  const botType = getBotTypeConfig(agent.botType);
  const balanceEth = balance ? (Number(balance) / 1e18).toFixed(4) : "0.0000";
  const isAutonomous = agent.isAutonomous ?? false;
  const capabilities = agent.capabilities ?? {};

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          to="/agents"
          className="text-sm flex items-center gap-1 hover:underline"
          style={{ color: "var(--text-tertiary)" }}
        >
          ← Agents
        </Link>
      </nav>

      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8">
        <div className="flex items-start gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl flex-shrink-0"
            style={{ backgroundColor: "rgba(99, 102, 241, 0.1)" }}
            role="img"
            aria-label={botType.label}
          >
            {botType.icon}
          </div>
          <div>
            <h1
              className="text-2xl sm:text-3xl font-bold mb-2 font-display"
              style={{ color: "var(--text-primary)" }}
            >
              {agent.name}
            </h1>
            {agent.description && (
              <p
                className="text-sm mb-3 max-w-md"
                style={{ color: "var(--text-secondary)" }}
              >
                {agent.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className={agent.active ? "badge-success" : "badge-error"}>
                <span
                  className="w-1.5 h-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                {agent.active ? "Active" : "Inactive"}
              </span>
              <span className={botType.badgeClass}>{botType.label}</span>
              {isAutonomous && (
                <span
                  className="badge"
                  style={{
                    backgroundColor: "rgba(245, 158, 11, 0.15)",
                    color: "rgb(245, 158, 11)",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"
                    aria-hidden="true"
                  />
                  Autonomous
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <Link to={`/chat?character=${id}`} className="btn-secondary">
            Chat
          </Link>
          <button
            type="button"
            onClick={handleExecute}
            disabled={triggerTick.isPending}
            className="btn-primary"
          >
            {triggerTick.isPending ? <LoadingSpinner size="sm" /> : "Execute"}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl mb-6"
        style={{ backgroundColor: "var(--bg-secondary)" }}
        role="tablist"
      >
        {(["overview", "actions", "settings"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-[var(--surface)] shadow-sm"
                : "hover:bg-[var(--surface)]/50"
            }`}
            style={{
              color:
                activeTab === tab
                  ? "var(--text-primary)"
                  : "var(--text-tertiary)",
            }}
            role="tab"
            aria-selected={activeTab === tab}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Capabilities */}
            <section
              className="card-static p-6"
              aria-labelledby="capabilities-heading"
            >
              <h2
                id="capabilities-heading"
                className="text-lg font-bold mb-5 font-display"
                style={{ color: "var(--text-primary)" }}
              >
                Capabilities
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(CAPABILITY_CONFIG).map(([key, config]) => {
                  const enabled =
                    capabilities[key as keyof typeof capabilities];
                  return (
                    <div
                      key={key}
                      className={`p-4 rounded-xl ${enabled ? "" : "opacity-40"}`}
                      style={{
                        backgroundColor: enabled
                          ? "rgba(99, 102, 241, 0.1)"
                          : "var(--bg-secondary)",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">{config.icon}</span>
                        <span
                          className="font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {config.label}
                        </span>
                      </div>
                      <p
                        className="text-xs"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {config.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Statistics */}
            <section
              className="card-static p-6"
              aria-labelledby="stats-heading"
            >
              <h2
                id="stats-heading"
                className="text-lg font-bold mb-5 font-display"
                style={{ color: "var(--text-primary)" }}
              >
                Activity
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <div
                  className="p-4 rounded-xl text-center"
                  style={{ backgroundColor: "var(--bg-secondary)" }}
                >
                  <p
                    className="text-xs mb-1"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Executions
                  </p>
                  <p
                    className="text-2xl font-bold tabular-nums"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {agent.executionCount.toLocaleString()}
                  </p>
                </div>
                <div
                  className="p-4 rounded-xl text-center"
                  style={{ backgroundColor: "var(--bg-secondary)" }}
                >
                  <p
                    className="text-xs mb-1"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Last Active
                  </p>
                  <p
                    className="text-lg font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {agent.lastExecutedAt > 0
                      ? formatDistanceToNow(agent.lastExecutedAt)
                      : "Never"}
                  </p>
                </div>
                <div
                  className="p-4 rounded-xl text-center"
                  style={{ backgroundColor: "var(--bg-secondary)" }}
                >
                  <p
                    className="text-xs mb-1"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Registered
                  </p>
                  <p
                    className="text-lg font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {formatDistanceToNow(agent.registeredAt)}
                  </p>
                </div>
              </div>
            </section>

            {/* On-Chain Data */}
            <section
              className="card-static p-6"
              aria-labelledby="addresses-heading"
            >
              <h2
                id="addresses-heading"
                className="text-lg font-bold mb-5 font-display"
                style={{ color: "var(--text-primary)" }}
              >
                On-Chain Data
              </h2>
              <dl className="space-y-4">
                <AddressField label="Agent ID" value={agent.agentId} />
                <AddressField label="Owner" value={agent.owner} />
                <AddressField label="Vault" value={agent.vaultAddress} />
                {agent.characterCid && (
                  <AddressField
                    label="Character CID"
                    value={agent.characterCid}
                    href={getIpfsUrl(agent.characterCid)}
                  />
                )}
              </dl>
            </section>
          </div>

          {/* Right Column - Vault */}
          <div className="space-y-6">
            <section
              className="card-static p-6"
              aria-labelledby="vault-heading"
            >
              <h2
                id="vault-heading"
                className="text-lg font-bold mb-5 font-display"
                style={{ color: "var(--text-primary)" }}
              >
                Vault
              </h2>
              <div className="space-y-4">
                <div
                  className="p-4 rounded-xl"
                  style={{ backgroundColor: "var(--bg-secondary)" }}
                >
                  <p
                    className="text-sm mb-1"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Balance
                  </p>
                  <p
                    className="text-2xl font-bold font-mono"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {balanceEth}{" "}
                    <span className="text-base font-normal">ETH</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFundModal(true)}
                  className="btn-secondary w-full"
                >
                  Fund Vault
                </button>
              </div>
            </section>

            {/* Autonomous Mode */}
            <section
              className="card-static p-6"
              aria-labelledby="autonomous-heading"
            >
              <h2
                id="autonomous-heading"
                className="text-lg font-bold mb-4 font-display"
                style={{ color: "var(--text-primary)" }}
              >
                Autonomous Mode
              </h2>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-secondary)" }}
              >
                When enabled, the agent runs automatically on a fixed interval.
              </p>
              <div
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ backgroundColor: "var(--bg-secondary)" }}
              >
                <div>
                  <p
                    className="font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {isAutonomous ? "Enabled" : "Disabled"}
                  </p>
                  {isAutonomous && (
                    <p
                      className="text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Tick every{" "}
                      {Math.round((agent.tickIntervalMs ?? 0) / 1000)}s
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleToggleAutonomous}
                  disabled={toggleAutonomous.isPending}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    isAutonomous
                      ? "bg-[var(--color-primary)]"
                      : "bg-[var(--bg-tertiary)]"
                  }`}
                  role="switch"
                  aria-checked={isAutonomous}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      isAutonomous ? "translate-x-6" : ""
                    }`}
                  />
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Actions Tab */}
      {activeTab === "actions" && (
        <section className="card-static p-6" aria-labelledby="actions-heading">
          <div className="flex items-center justify-between mb-5">
            <h2
              id="actions-heading"
              className="text-lg font-bold font-display"
              style={{ color: "var(--text-primary)" }}
            >
              Recent Activity
            </h2>
            {agentActivity && (
              <div
                className="flex items-center gap-4 text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                <span>Ticks: {agentActivity.tickCount}</span>
                {agentActivity.lastTick > 0 && (
                  <span>
                    Last: {formatActivityTime(agentActivity.lastTick)}
                  </span>
                )}
              </div>
            )}
          </div>

          {isActivityLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : agentActivity?.recentActivity &&
            agentActivity.recentActivity.length > 0 ? (
            <ul className="space-y-3">
              {[...agentActivity.recentActivity]
                .reverse()
                .map((activity, index) => {
                  const key = `${activity.action}-${activity.timestamp}-${index}`;
                  const isExpanded = expandedActivities.has(key);
                  const preview = formatResult(activity.result);
                  const fullResult = getFullResult(activity.result);
                  const hasResult = !!activity.result;

                  return (
                    <li
                      key={key}
                      className="rounded-xl overflow-hidden"
                      style={{
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => hasResult && toggleActivityExpanded(key)}
                        className="w-full flex items-center gap-4 p-4 text-left"
                        style={{ cursor: hasResult ? "pointer" : "default" }}
                      >
                        <span
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                          style={{
                            backgroundColor: activity.success
                              ? "var(--color-success)"
                              : "var(--color-error)",
                            color: "white",
                            opacity: 0.9,
                          }}
                        >
                          {activity.success ? "\u2713" : "\u2717"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-base font-semibold"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {activity.action}
                          </p>
                          {preview && !isExpanded && (
                            <p
                              className="text-sm truncate mt-1"
                              style={{ color: "var(--text-tertiary)" }}
                            >
                              {preview}...
                            </p>
                          )}
                        </div>
                        <span
                          className="text-sm whitespace-nowrap"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {formatActivityTime(activity.timestamp)}
                        </span>
                        {hasResult && (
                          <span
                            className="text-sm flex-shrink-0"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {isExpanded ? "\u25BC" : "\u25B6"}
                          </span>
                        )}
                      </button>
                      {isExpanded && fullResult && (
                        <div
                          className="px-4 pb-4"
                          style={{ borderTop: "1px solid var(--border)" }}
                        >
                          <pre
                            className="text-sm font-mono p-3 rounded-lg overflow-auto mt-3"
                            style={{
                              backgroundColor: "var(--bg-primary)",
                              color: "var(--text-secondary)",
                              maxHeight: "300px",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {fullResult}
                          </pre>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          ) : (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">📋</div>
              <p style={{ color: "var(--text-tertiary)" }}>
                No activity recorded yet. Execute the agent to see activity.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Settings Tab */}
      {activeTab === "settings" && (
        <section className="card-static p-6" aria-labelledby="settings-heading">
          <h2
            id="settings-heading"
            className="text-lg font-bold mb-5 font-display"
            style={{ color: "var(--text-primary)" }}
          >
            Agent Settings
          </h2>
          <p className="mb-6" style={{ color: "var(--text-secondary)" }}>
            Configure agent behavior and capabilities.
          </p>

          <div className="space-y-6">
            {/* Autonomous Settings */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--bg-secondary)" }}
            >
              <h3
                className="font-medium mb-3"
                style={{ color: "var(--text-primary)" }}
              >
                Autonomous Mode
              </h3>
              <div className="flex items-center justify-between">
                <p
                  className="text-sm"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Enable agent to run on fixed tick intervals
                </p>
                <button
                  type="button"
                  onClick={handleToggleAutonomous}
                  disabled={toggleAutonomous.isPending}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    isAutonomous
                      ? "bg-[var(--color-primary)]"
                      : "bg-[var(--bg-tertiary)]"
                  }`}
                  role="switch"
                  aria-checked={isAutonomous}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      isAutonomous ? "translate-x-6" : ""
                    }`}
                  />
                </button>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="autonomous-watch-room"
                    className="block text-xs font-medium mb-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Watch Room (optional)
                  </label>
                  <input
                    id="autonomous-watch-room"
                    type="text"
                    list="autonomous-room-options-detail"
                    value={autonomousRooms.watchRoom}
                    onChange={(e) =>
                      setAutonomousRooms((prev) => ({
                        ...prev,
                        watchRoom: e.target.value,
                      }))
                    }
                    placeholder="capability-demos"
                    className="input"
                  />
                </div>
                <div>
                  <label
                    htmlFor="autonomous-post-room"
                    className="block text-xs font-medium mb-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Post To Room (optional)
                  </label>
                  <input
                    id="autonomous-post-room"
                    type="text"
                    list="autonomous-room-options-detail"
                    value={autonomousRooms.postToRoom}
                    onChange={(e) =>
                      setAutonomousRooms((prev) => ({
                        ...prev,
                        postToRoom: e.target.value,
                      }))
                    }
                    placeholder="capability-demos"
                    className="input"
                  />
                </div>
              </div>
              <p
                className="text-xs mt-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                Room settings apply when enabling. Disable and re-enable to
                update.
              </p>
              {roomsData?.rooms && roomsData.rooms.length > 0 && (
                <datalist id="autonomous-room-options-detail">
                  {roomsData.rooms.map((room) => (
                    <option
                      key={room.roomId}
                      value={room.roomId}
                      label={room.name}
                    />
                  ))}
                </datalist>
              )}
            </div>

            {/* Danger Zone */}
            <div
              className="p-4 rounded-xl border"
              style={{
                borderColor: "var(--color-error)",
                backgroundColor: "rgba(244, 63, 94, 0.05)",
              }}
            >
              <h3
                className="font-medium mb-3"
                style={{ color: "var(--color-error)" }}
              >
                Danger Zone
              </h3>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-secondary)" }}
              >
                Deactivating an agent will stop all executions.
              </p>
              <button
                type="button"
                className="btn-ghost"
                style={{ color: "var(--color-error)" }}
              >
                Deactivate Agent
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Fund Modal */}
      {showFundModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowFundModal(false)}
          onKeyDown={(e) => e.key === "Escape" && setShowFundModal(false)}
        >
          <div
            role="document"
            className="card-static p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg font-bold mb-4 font-display"
              style={{ color: "var(--text-primary)" }}
            >
              Fund Vault
            </h3>
            <form onSubmit={handleFund} className="space-y-4">
              <div>
                <label
                  htmlFor="fund-amount"
                  className="block text-sm mb-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Amount
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="fund-amount"
                    type="number"
                    step="0.001"
                    min="0"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="input flex-1"
                    required
                  />
                  <span
                    className="text-sm font-mono"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    ETH
                  </span>
                </div>
                {fundAmount && (
                  <p
                    className="text-xs mt-2"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Est. gas: ~0.001 ETH
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowFundModal(false)}
                  className="btn-ghost flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!fundAmount || fundVault.isPending}
                  className="btn-primary flex-1"
                >
                  {fundVault.isPending ? <LoadingSpinner size="sm" /> : "Fund"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

interface AddressFieldProps {
  label: string;
  value: string;
  href?: string;
}

function AddressField({ label, value, href }: AddressFieldProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  };

  return (
    <div>
      <dt className="text-sm mb-1.5" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </dt>
      <dd className="flex items-center gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-mono px-3 py-2.5 rounded-lg flex-1 truncate no-underline hover:underline"
            style={{
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-secondary)",
            }}
          >
            {value}
          </a>
        ) : (
          <code
            className="text-sm font-mono px-3 py-2.5 rounded-lg flex-1 truncate"
            style={{
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-secondary)",
            }}
          >
            {value}
          </code>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="icon-btn flex-shrink-0"
          style={{ backgroundColor: "var(--bg-secondary)" }}
          aria-label={`Copy ${label}`}
          title="Copy"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>
      </dd>
    </div>
  );
}
