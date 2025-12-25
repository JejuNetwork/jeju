"""
Jeju RL Training System - Atropos Framework

This package provides training infrastructure for Jeju agents:

1. **Atropos Training** (Local GPU)
   - `atropos_trainer.py` - Local GRPO trainer with vLLM
   - `jeju_env.py` - RLAIF environment with LLM-as-judge

2. **Data & Utilities**
   - `rollout_generator.py` - Fast rollout generation
   - `rewards.py` - Reward functions
   - `quality_utils.py` - Trajectory quality scoring
"""

__version__ = "3.1.0"
