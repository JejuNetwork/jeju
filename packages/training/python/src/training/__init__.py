"""
RL Training orchestration for Jeju

This package provides training infrastructure:

1. **Atropos-based Trainer** (RECOMMENDED)
   - `atropos_trainer.py` - GRPO trainer consuming from Atropos API
   - `jeju_env.py` - RLAIF environment with LLM-as-judge scoring

2. **Fast Rollout Generation**
   - `rollout_generator.py` - High-speed rollout generation with full agent tick capture
   - `fast_simulator.py` - Unified simulator for benchmark + data generation
   - `multi_prompt_dataset.py` - Dataset preparation for each LLM call type

3. **Supporting Modules**
   - `rewards.py` - Reward functions and normalization
   - `quality_utils.py` - Trajectory quality scoring
   - `tick_reward_attribution.py` - Granular reward attribution for multi-call ticks

See README.md for usage instructions.
"""

# Import non-torch modules directly
# Archetype training configuration (no torch dependency)
from .archetype_trainer import (
    ArchetypeTrainer,
    ArchetypeTrainingConfig,
    ArchetypeTrainingResult,
)

# Multi-prompt dataset (no torch dependency)
from .multi_prompt_dataset import (
    MultiPromptDatasetBuilder,
    PromptDataset,
    PromptSample,
    PromptTypeAnalyzer,
    prepare_multi_prompt_training_data,
    validate_training_sample,
    validate_trajectory_for_training,
)

# Quality utilities (no torch dependency)
from .quality_utils import (
    ValidationResult,
    build_trajectory_from_ticks,
    calculate_detailed_tick_quality,
    calculate_tick_quality_score,
    calculate_trajectory_quality_score,
    state_to_env_state,
    state_to_observation,
    validate_trajectory_quality,
)
from .rewards import (
    RewardNormalizer,
    action_quality_reward,
    composite_reward,
    efficiency_reward,
    pairwise_preferences_to_scores,
    pnl_reward,
    ranking_to_scores,
    relative_scores,
    risk_adjusted_reward,
)

# Rubric loading from config/rubrics.json (single source of truth)
from .rubric_loader import (
    DEFAULT_RUBRIC,
    get_available_archetypes,
    get_priority_metrics,
    get_rubric,
    reload_rubrics,
)

# Tick reward attribution (no torch dependency)
from .tick_reward_attribution import (
    CallPurpose,
    LLMCallRecord,
    TickData,
    TickOutcome,
    TickRewardAttributor,
    build_training_samples_from_tick,
    group_samples_for_grpo,
)


# Lazy imports for torch-dependent modules
def __getattr__(name: str):
    """Lazy import for torch-dependent modules."""
    if name in (
        "JejuAtroposTrainer",
        "AtroposTrainingConfig",
    ):
        from .atropos_trainer import (
            AtroposTrainingConfig,
            JejuAtroposTrainer,
        )

        return locals()[name]

    if name in (
        "JejuRLAIFEnv",
        "JejuEnvConfig",
    ):
        from .jeju_env import (
            JejuEnvConfig,
            JejuRLAIFEnv,
        )

        return locals()[name]

    if name in (
        "FastRolloutGenerator",
        "RolloutConfig",
        "RolloutResult",
        "AgentTickData",
        "RolloutQualityValidator",
        "AgentRunner",
    ):
        from .rollout_generator import (
            AgentRunner,
            AgentTickData,
            FastRolloutGenerator,
            RolloutConfig,
            RolloutQualityValidator,
            RolloutResult,
        )

        return locals()[name]

    if name in (
        "FastSimulator",
        "SimulatorConfig",
        "SimulatorMetrics",
        "GameState",
    ):
        from .fast_simulator import (
            FastSimulator,
            GameState,
            SimulatorConfig,
            SimulatorMetrics,
        )

        return locals()[name]

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "DEFAULT_RUBRIC",
    "AgentRunner",
    "AgentTickData",
    "ArchetypeTrainer",
    "ArchetypeTrainingConfig",
    "ArchetypeTrainingResult",
    "AtroposTrainingConfig",
    "JejuAtroposTrainer",
    "JejuEnvConfig",
    "JejuRLAIFEnv",
    "CallPurpose",
    "FastRolloutGenerator",
    "FastSimulator",
    "GameState",
    "LLMCallRecord",
    "MultiPromptDatasetBuilder",
    "PromptDataset",
    "PromptSample",
    "PromptTypeAnalyzer",
    "RewardNormalizer",
    "RolloutConfig",
    "RolloutQualityValidator",
    "RolloutResult",
    "SimulatorConfig",
    "SimulatorMetrics",
    "TickData",
    "TickOutcome",
    "TickRewardAttributor",
    "ValidationResult",
    "action_quality_reward",
    "build_training_samples_from_tick",
    "build_trajectory_from_ticks",
    "calculate_detailed_tick_quality",
    "calculate_tick_quality_score",
    "calculate_trajectory_quality_score",
    "composite_reward",
    "efficiency_reward",
    "get_available_archetypes",
    "get_priority_metrics",
    "get_rubric",
    "group_samples_for_grpo",
    "pairwise_preferences_to_scores",
    "pnl_reward",
    "prepare_multi_prompt_training_data",
    "ranking_to_scores",
    "relative_scores",
    "reload_rubrics",
    "risk_adjusted_reward",
    "state_to_env_state",
    "state_to_observation",
    "validate_training_sample",
    "validate_trajectory_for_training",
    "validate_trajectory_quality",
]
