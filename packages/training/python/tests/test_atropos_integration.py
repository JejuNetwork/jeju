"""
Integration tests for Jeju Training RLAIF implementation

Tests:
1. Module imports work correctly
2. Data conversion functions work
3. Reward functions produce valid outputs
4. Environment can be instantiated (mock mode)
"""

from datetime import datetime

import pytest

# Check for optional dependencies
HAS_TORCH = False
try:
    import torch

    _ = torch.__version__  # Use the import to satisfy linter
    HAS_TORCH = True
except ImportError:
    pass

requires_torch = pytest.mark.skipif(not HAS_TORCH, reason="torch not installed")


class TestImports:
    """Verify all modules can be imported"""

    def test_import_models(self):
        from src.models import (
            AtroposScoredGroup,
            JejuTrajectory,
        )

        assert JejuTrajectory is not None
        assert AtroposScoredGroup is not None

    def test_import_converter(self):
        from src.data_bridge import (
            JejuToAtroposConverter,
            ScoredGroupResult,
        )

        assert JejuToAtroposConverter is not None
        assert ScoredGroupResult is not None

    def test_import_rewards(self):
        from src.training.rewards import (
            RewardNormalizer,
            TrajectoryRewardInputs,
            pnl_reward,
        )

        assert pnl_reward is not None
        assert RewardNormalizer is not None
        assert TrajectoryRewardInputs is not None

    @requires_torch
    def test_import_trainer(self):
        from src.training import (
            JejuAtroposTrainer,
        )

        assert JejuAtroposTrainer is not None

    @requires_torch
    def test_import_environment(self):
        from src.training import (
            JejuRLAIFEnv,
        )

        assert JejuRLAIFEnv is not None


class TestRewardFunctions:
    """Test reward calculation functions"""

    def test_pnl_reward_positive(self):
        from src.training.rewards import TrajectoryRewardInputs, pnl_reward

        inputs = TrajectoryRewardInputs(final_pnl=500.0, starting_balance=10000.0)
        reward = pnl_reward(inputs)
        assert reward > 0

    def test_pnl_reward_negative(self):
        from src.training.rewards import TrajectoryRewardInputs, pnl_reward

        inputs = TrajectoryRewardInputs(final_pnl=-500.0, starting_balance=10000.0)
        reward = pnl_reward(inputs)
        assert reward < 0

    def test_pnl_reward_zero(self):
        from src.training.rewards import TrajectoryRewardInputs, pnl_reward

        inputs = TrajectoryRewardInputs(final_pnl=0.0, starting_balance=10000.0)
        reward = pnl_reward(inputs)
        assert reward == 0.0

    def test_efficiency_reward(self):
        from src.training.rewards import TrajectoryRewardInputs, efficiency_reward

        inputs = TrajectoryRewardInputs(final_pnl=500.0, starting_balance=10000.0, total_actions=5)
        reward = efficiency_reward(inputs)
        assert -1.0 <= reward <= 1.0

    def test_composite_reward(self):
        from src.training.rewards import TrajectoryRewardInputs, composite_reward

        inputs = TrajectoryRewardInputs(
            final_pnl=500.0,
            starting_balance=10000.0,
            end_balance=10500.0,
            format_score=0.8,
            reasoning_score=0.7,
        )

        reward = composite_reward(inputs)
        assert -1.0 <= reward <= 1.0

    def test_relative_scores(self):
        from src.training.rewards import relative_scores

        # Pass raw reward values, not trajectories
        rewards = [1.0, 0.0, -0.5]

        scores = relative_scores(rewards)

        # Scores should be in [0, 1]
        assert all(0 <= s <= 1 for s in scores)
        # Best should have highest score
        assert scores[0] > scores[1] > scores[2]

    def test_reward_normalizer(self):
        from src.training.rewards import RewardNormalizer

        normalizer = RewardNormalizer(epsilon=1e-8)

        # Update with some rewards
        normalizer.update(0.5)
        normalizer.update(0.6)
        normalizer.update(0.7)
        normalizer.update(0.8)

        # Normalize should return a float
        normalized = normalizer.normalize(0.65)
        assert isinstance(normalized, float)


class TestConverter:
    """Test Jeju to Atropos conversion"""

    def create_sample_trajectory(self):
        """Create a sample trajectory for testing"""
        from src.models import (
            Action,
            JejuTrajectory,
            EnvironmentState,
            LLMCall,
            TrajectoryStep,
        )

        steps = []
        for i in range(5):
            step = TrajectoryStep(
                step_number=i,
                timestamp=1000000 + i * 1000,
                environment_state=EnvironmentState(
                    agent_balance=10000.0 + i * 100,
                    agentPnL=i * 100.0,
                    open_positions=i,
                ),
                provider_accesses=[],
                llm_calls=[
                    LLMCall(
                        model="gpt-4",
                        system_prompt="You are a trading agent. Analyze markets carefully.",
                        user_prompt=f"Market update {i}: Current price is $100. Should you buy?",
                        response=f"Based on my analysis of the market conditions, I recommend action {i}.",
                        temperature=0.7,
                        max_tokens=100,
                        purpose="action",
                    )
                ],
                action=Action(
                    action_type="trade",
                    parameters={"amount": 100},
                    success=True,
                ),
                reward=0.1,
            )
            steps.append(step)

        return JejuTrajectory(
            id="test-1",
            trajectory_id="traj-1",
            agent_id="agent-1",
            window_id="2024-01-01T00:00",
            start_time=datetime.now(),
            end_time=datetime.now(),
            duration_ms=5000,
            steps=steps,
            total_reward=0.5,
            final_pnl=400.0,
            episode_length=5,
            final_status="completed",
        )

    def test_convert_trajectory(self):
        from src.data_bridge import JejuToAtroposConverter

        converter = JejuToAtroposConverter()
        traj = self.create_sample_trajectory()

        result = converter.convert_trajectory(traj)

        assert result is not None
        assert len(result.messages) >= 3
        assert result.metadata["trajectory_id"] == "traj-1"
        assert result.metadata["final_pnl"] == 400.0

    def test_convert_window_group(self):
        from src.data_bridge import JejuToAtroposConverter

        converter = JejuToAtroposConverter()
        trajs = [self.create_sample_trajectory() for _ in range(4)]

        # Modify trajectory IDs
        for i, t in enumerate(trajs):
            t.trajectory_id = f"traj-{i}"

        result = converter.convert_window_group(trajs, None)

        assert result.group_size == 4
        assert len(result.scores) == 4
        assert len(result.messages) == 4


@requires_torch
class TestTrainerConfig:
    """Test trainer configuration (requires torch)"""

    def test_default_config(self):
        from src.training import AtroposTrainingConfig

        config = AtroposTrainingConfig()

        assert config.model_name == "Qwen/Qwen2.5-3B-Instruct"
        assert config.learning_rate == 1e-5
        assert config.training_steps == 100

    def test_custom_config(self):
        from src.training import AtroposTrainingConfig

        config = AtroposTrainingConfig(
            model_name="Qwen/Qwen2.5-7B-Instruct",
            training_steps=50,
            learning_rate=5e-6,
        )

        assert config.model_name == "Qwen/Qwen2.5-7B-Instruct"
        assert config.training_steps == 50
        assert config.learning_rate == 5e-6


@requires_torch
class TestEnvironmentConfig:
    """Test environment configuration (requires torch)"""

    def test_default_config(self):
        from src.training import JejuEnvConfig

        config = JejuEnvConfig()

        assert config.group_size == 4
        assert config.lookback_hours == 72
        assert config.min_agents_per_window == 2

    def test_custom_config(self):
        from src.training import JejuEnvConfig

        config = JejuEnvConfig(
            group_size=8,
            lookback_hours=48,
            judge_model="gpt-4",
        )

        assert config.group_size == 8
        assert config.lookback_hours == 48
        assert config.judge_model == "gpt-4"


class TestCalculateDropoutRate:
    """Test dropout rate calculation"""

    def test_no_dropout_needed(self):
        from src.data_bridge import calculate_dropout_rate

        rate = calculate_dropout_rate(500, target_trajectories=1000)
        assert rate == 0.0

    def test_dropout_needed(self):
        from src.data_bridge import calculate_dropout_rate

        rate = calculate_dropout_rate(2000, target_trajectories=1000)
        assert 0.0 < rate <= 0.3

    def test_max_dropout_cap(self):
        from src.data_bridge import calculate_dropout_rate

        rate = calculate_dropout_rate(10000, target_trajectories=1000, max_dropout=0.2)
        assert rate == 0.2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
