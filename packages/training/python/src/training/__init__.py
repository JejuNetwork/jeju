"""
RL Training orchestration for Jeju

This package provides training infrastructure:

1. **Atropos-based Trainer** (RECOMMENDED)
   - `atropos_trainer.py` - GRPO trainer consuming from Atropos API
   - `babylon_env.py` - RLAIF environment with LLM-as-judge scoring

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
from .rewards import (
    pnl_reward,
    risk_adjusted_reward,
    efficiency_reward,
    action_quality_reward,
    composite_reward,
    relative_scores,
    ranking_to_scores,
    pairwise_preferences_to_scores,
    RewardNormalizer,
)

# Quality utilities (no torch dependency)
from .quality_utils import (
    calculate_tick_quality_score,
    calculate_trajectory_quality_score,
    calculate_detailed_tick_quality,
    build_trajectory_from_ticks,
    state_to_observation,
    state_to_env_state,
    validate_trajectory_quality,
    ValidationResult,
)

# Multi-prompt dataset (no torch dependency)
from .multi_prompt_dataset import (
    MultiPromptDatasetBuilder,
    PromptDataset,
    PromptSample,
    prepare_multi_prompt_training_data,
    PromptTypeAnalyzer,
    validate_training_sample,
    validate_trajectory_for_training,
)

# Tick reward attribution (no torch dependency)
from .tick_reward_attribution import (
    TickRewardAttributor,
    TickData,
    TickOutcome,
    LLMCallRecord,
    CallPurpose,
    build_training_samples_from_tick,
    group_samples_for_grpo,
)

# Archetype training configuration (no torch dependency)
from .archetype_trainer import (
    ArchetypeTrainer,
    ArchetypeTrainingConfig,
    ArchetypeTrainingResult,
)

# Rubric loading from config/rubrics.json (single source of truth)
from .rubric_loader import (
    get_rubric,
    get_priority_metrics,
    get_available_archetypes,
    reload_rubrics,
    DEFAULT_RUBRIC,
)


# Lazy imports for torch-dependent modules
def __getattr__(name: str):
    """Lazy import for torch-dependent modules."""
    if name in (
        "BabylonAtroposTrainer",
        "AtroposTrainingConfig",
    ):
        from .atropos_trainer import (
            BabylonAtroposTrainer,
            AtroposTrainingConfig,
        )
        return locals()[name]
    
    if name in (
        "BabylonRLAIFEnv",
        "BabylonEnvConfig",
    ):
        from .babylon_env import (
            BabylonRLAIFEnv,
            BabylonEnvConfig,
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
            FastRolloutGenerator,
            RolloutConfig,
            RolloutResult,
            AgentTickData,
            RolloutQualityValidator,
            AgentRunner,
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
            SimulatorConfig,
            SimulatorMetrics,
            GameState,
        )
        return locals()[name]
    
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    # Atropos trainer (lazy - requires torch)
    "BabylonAtroposTrainer",
    "AtroposTrainingConfig",
    "BabylonRLAIFEnv",
    "BabylonEnvConfig",
    # Reward functions
    "pnl_reward",
    "risk_adjusted_reward",
    "efficiency_reward",
    "action_quality_reward",
    "composite_reward",
    "relative_scores",
    "ranking_to_scores",
    "pairwise_preferences_to_scores",
    "RewardNormalizer",
    # Fast rollout generation (lazy - may require torch)
    "FastRolloutGenerator",
    "RolloutConfig",
    "RolloutResult",
    "AgentTickData",
    "RolloutQualityValidator",
    "AgentRunner",
    "FastSimulator",
    "SimulatorConfig",
    "SimulatorMetrics",
    "GameState",
    "MultiPromptDatasetBuilder",
    "PromptDataset",
    "PromptSample",
    "prepare_multi_prompt_training_data",
    "PromptTypeAnalyzer",
    "validate_training_sample",
    "validate_trajectory_for_training",
    # Tick reward attribution
    "TickRewardAttributor",
    "TickData",
    "TickOutcome",
    "LLMCallRecord",
    "CallPurpose",
    "build_training_samples_from_tick",
    "group_samples_for_grpo",
    # Quality utilities
    "calculate_tick_quality_score",
    "calculate_trajectory_quality_score",
    "calculate_detailed_tick_quality",
    "build_trajectory_from_ticks",
    "state_to_observation",
    "state_to_env_state",
    "validate_trajectory_quality",
    "ValidationResult",
    # Archetype training
    "ArchetypeTrainer",
    "ArchetypeTrainingConfig",
    "ArchetypeTrainingResult",
    "get_rubric",
    "get_priority_metrics",
    "get_available_archetypes",
    "reload_rubrics",
    "DEFAULT_RUBRIC",
]
