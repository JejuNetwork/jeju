"""
Jeju RL Training System - Atropos Framework

This package provides training infrastructure for Jeju agents:

1. **Atropos Training** (Local GPU)
   - `atropos_trainer.py` - Local GRPO trainer with vLLM
   - `babylon_env.py` - RLAIF environment with LLM-as-judge

2. **Data & Utilities**
   - `rollout_generator.py` - Fast rollout generation
   - `rewards.py` - Reward functions
   - `quality_utils.py` - Trajectory quality scoring
"""

__version__ = "3.1.0"

# Import and re-export main components
from .data_bridge import (
    BabylonToAtroposConverter,
    PostgresTrajectoryReader,
    ScoredGroupResult,
    calculate_dropout_rate,
)
from .models import (
    AtroposScoredGroup,
    BabylonTrajectory,
    JudgeResponse,
    MarketOutcomes,
    TrainingBatchSummary,
    WindowStatistics,
)

# Import non-torch training components directly
from .training import (
    CallPurpose,
    # Multi-prompt dataset
    MultiPromptDatasetBuilder,
    PromptDataset,
    PromptSample,
    RewardNormalizer,
    # Tick reward attribution
    TickRewardAttributor,
    # Quality utilities
    calculate_tick_quality_score,
    calculate_trajectory_quality_score,
    composite_reward,
    get_available_archetypes,
    # Archetype utilities (no torch)
    get_rubric,
    # Reward functions
    pnl_reward,
)


# Lazy imports for torch-dependent modules
def __getattr__(name: str):
    """Lazy import for torch-dependent modules."""
    # Atropos trainer (requires torch)
    if name in (
        "BabylonAtroposTrainer",
        "AtroposTrainingConfig",
    ):
        from .training.atropos_trainer import (
            AtroposTrainingConfig,
            BabylonAtroposTrainer,
        )

        return locals()[name]

    if name in (
        "BabylonRLAIFEnv",
        "BabylonEnvConfig",
    ):
        from .training.babylon_env import (
            BabylonEnvConfig,
            BabylonRLAIFEnv,
        )

        return locals()[name]

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    # Models
    "BabylonTrajectory",
    "MarketOutcomes",
    "WindowStatistics",
    "TrainingBatchSummary",
    "AtroposScoredGroup",
    "JudgeResponse",
    # Data Bridge
    "PostgresTrajectoryReader",
    "BabylonToAtroposConverter",
    "ScoredGroupResult",
    "calculate_dropout_rate",
    # Atropos Training (lazy - requires torch)
    "BabylonAtroposTrainer",
    "AtroposTrainingConfig",
    "BabylonRLAIFEnv",
    "BabylonEnvConfig",
    # Rewards (no torch)
    "pnl_reward",
    "composite_reward",
    "RewardNormalizer",
    # Quality utilities (no torch)
    "calculate_tick_quality_score",
    "calculate_trajectory_quality_score",
    # Multi-prompt dataset (no torch)
    "MultiPromptDatasetBuilder",
    "PromptDataset",
    "PromptSample",
    # Tick reward (no torch)
    "TickRewardAttributor",
    "CallPurpose",
    # Archetype utilities (no torch)
    "get_rubric",
    "get_available_archetypes",
]
