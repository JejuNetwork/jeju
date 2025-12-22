#!/usr/bin/env python3
"""
Jeju Training Pipeline Validation

Validates the complete training pipeline before training:
1. Database connectivity
2. Real trajectory data availability
3. Data conversion to training format
4. Backend availability (MLX/CUDA/CPU)
5. Reward function testing

Run this BEFORE training to verify everything is set up correctly.

Usage:
    python scripts/validate.py
    python scripts/validate.py --test-rewards  # Also test reward functions on data
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


class TestResult:
    def __init__(self, name: str):
        self.name = name
        self.passed = False
        self.message = ""
        self.details: dict = {}


def test_environment_variables() -> TestResult:
    """Test required environment variables."""
    result = TestResult("Environment Variables")

    checks = {
        "DATABASE_URL": bool(os.getenv("DATABASE_URL")),
        "OPENAI_API_KEY": bool(os.getenv("OPENAI_API_KEY")),
    }

    required = ["DATABASE_URL"]
    optional = ["OPENAI_API_KEY"]

    missing_required = [k for k in required if not checks[k]]
    missing_optional = [k for k in optional if not checks[k]]

    result.passed = len(missing_required) == 0

    if result.passed:
        result.message = (
            f"Required vars set. Optional missing: {', '.join(missing_optional) or 'none'}"
        )
    else:
        result.message = f"Missing required: {', '.join(missing_required)}"

    result.details = checks
    return result


async def test_database_connection() -> TestResult:
    """Test database connectivity."""
    result = TestResult("Database Connection")

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        result.message = "DATABASE_URL not set"
        return result

    try:
        import psycopg2

        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM trajectories")
        row = cur.fetchone()
        if row is None:
            cur.close()
            conn.close()
            result.message = "No trajectories found in database"
            return result
        count: int = row[0]
        cur.close()
        conn.close()

        result.passed = True
        result.message = f"Connected. Found {count} trajectories"
        result.details["trajectory_count"] = count

    except ImportError:
        result.message = "psycopg2 not installed. Run: pip install psycopg2-binary"
    except Exception as e:
        result.message = f"Connection failed: {e}"

    return result


async def test_trajectory_data() -> TestResult:
    """Test that real trajectory data exists."""
    result = TestResult("Real Trajectory Data")

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        result.message = "DATABASE_URL not set"
        return result

    try:
        from src.data_bridge import PostgresTrajectoryReader

        async with PostgresTrajectoryReader(database_url) as reader:
            windows = await reader.get_window_ids(min_agents=1, lookback_hours=168)

            if not windows:
                result.message = "No trajectory windows found"
                return result

            trajectories = await reader.get_trajectories_by_window(windows[0], min_actions=1)

            with_llm_calls = 0
            total_llm_calls = 0

            for traj in trajectories:
                import json

                steps = json.loads(traj.steps_json)
                has_calls = False
                for step in steps:
                    llm_calls = step.get("llmCalls") or step.get("llm_calls") or []
                    if llm_calls:
                        total_llm_calls += len(llm_calls)
                        has_calls = True
                if has_calls:
                    with_llm_calls += 1

            result.passed = with_llm_calls > 0
            result.message = (
                f"Found {len(windows)} windows, "
                f"{len(trajectories)} trajectories in first window, "
                f"{with_llm_calls} have LLM calls ({total_llm_calls} total calls)"
            )
            result.details = {
                "windows": len(windows),
                "trajectories": len(trajectories),
                "with_llm_calls": with_llm_calls,
                "total_llm_calls": total_llm_calls,
            }

    except Exception as e:
        result.message = f"Failed: {e}"
        import traceback

        traceback.print_exc()

    return result


async def test_data_conversion() -> TestResult:
    """Test conversion of trajectories to training samples."""
    result = TestResult("Data Conversion")

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        result.message = "DATABASE_URL not set"
        return result

    try:
        import json

        from src.data_bridge import PostgresTrajectoryReader

        async with PostgresTrajectoryReader(database_url) as reader:
            windows = await reader.get_window_ids(min_agents=1, lookback_hours=168)

            if not windows:
                result.message = "No windows found"
                return result

            trajectories = await reader.get_trajectories_by_window(windows[0], min_actions=1)

        samples = []
        for traj in trajectories:
            steps = json.loads(traj.steps_json)
            for step in steps:
                llm_calls = step.get("llmCalls") or step.get("llm_calls") or []
                for llm_call in llm_calls:
                    response = llm_call.get("response") or ""
                    if len(response) < 20:
                        continue

                    messages = []
                    system = llm_call.get("systemPrompt") or llm_call.get("system_prompt")
                    user = llm_call.get("userPrompt") or llm_call.get("user_prompt")

                    if system:
                        messages.append({"role": "system", "content": system})
                    if user:
                        messages.append({"role": "user", "content": user})
                    messages.append({"role": "assistant", "content": response})

                    if len(messages) >= 2:
                        samples.append({"messages": messages})

        result.passed = len(samples) >= 10
        result.message = f"Created {len(samples)} training samples"
        result.details["samples"] = len(samples)

    except Exception as e:
        result.message = f"Failed: {e}"
        import traceback

        traceback.print_exc()

    return result


def test_mlx_backend() -> TestResult:
    """Test MLX backend availability."""
    result = TestResult("MLX Backend")

    try:
        import mlx.core as mx  # type: ignore
        import mlx_lm  # type: ignore

        result.passed = True
        result.message = f"MLX available (mlx-lm version: {mlx_lm.__version__})"

    except ImportError as e:
        result.message = f"MLX not available: {e}"

    return result


def test_cuda_backend() -> TestResult:
    """Test CUDA backend availability."""
    result = TestResult("CUDA Backend")

    try:
        import torch

        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory / 1e9

            result.passed = True
            result.message = f"CUDA available: {device_name} ({vram:.1f} GB)"
            result.details = {"device": device_name, "vram_gb": vram}
        else:
            result.message = "PyTorch installed but CUDA not available"

    except ImportError as e:
        result.message = f"PyTorch not installed: {e}"

    return result


def test_transformers() -> TestResult:
    """Test transformers library."""
    result = TestResult("Transformers Library")

    try:
        import transformers

        result.passed = True
        result.message = f"transformers {transformers.__version__}"

    except ImportError as e:
        result.message = f"Not installed: {e}"

    return result


def test_rewards_on_trajectory(trajectory_data: dict) -> dict:
    """Test reward functions on a trajectory."""
    from src.training.rewards import (
        TrajectoryRewardInputs,
        calculate_pnl_reward,
        composite_reward,
    )

    start_bal = 10000.0
    final_pnl = trajectory_data.get("final_pnl", 0.0)
    end_bal = start_bal + final_pnl

    pnl_score = calculate_pnl_reward(start_bal, end_bal)

    # Simple quality metrics from raw data
    total_format = 0.0
    total_reasoning = 0.0
    valid_steps = 0

    steps = trajectory_data.get("steps", [])
    for step in steps:
        llm_calls = step.get("llmCalls") or step.get("llm_calls") or []
        if not llm_calls:
            continue

        valid_steps += 1

        # Simple format check: does response contain structured thinking?
        for call in llm_calls:
            response = call.get("response", "")
            if "<thinking>" in response or "<analysis>" in response:
                total_format += 1.0
            elif len(response) > 100:
                total_format += 0.5

            # Simple reasoning check: does it mention trading concepts?
            trading_keywords = ["market", "trade", "buy", "sell", "position", "risk", "profit"]
            reasoning = call.get("reasoning", "") or response
            if any(kw in reasoning.lower() for kw in trading_keywords):
                total_reasoning += 1.0
            elif len(reasoning) > 50:
                total_reasoning += 0.3

    avg_format = total_format / max(1, valid_steps)
    avg_reasoning = total_reasoning / max(1, valid_steps)

    # Normalize to 0-1 range
    avg_format = min(1.0, avg_format)
    avg_reasoning = min(1.0, avg_reasoning)

    inputs = TrajectoryRewardInputs(
        final_pnl=final_pnl,
        starting_balance=start_bal,
        end_balance=end_bal,
        format_score=avg_format,
        reasoning_score=avg_reasoning,
    )

    final_score = composite_reward(inputs)

    return {
        "pnl_score": pnl_score,
        "format_score": avg_format,
        "reasoning_score": avg_reasoning,
        "composite_score": final_score,
        "verdict": "PASS" if final_score > 0 else "FAIL",
    }


async def test_reward_functions() -> TestResult:
    """Test reward functions on real data."""
    result = TestResult("Reward Functions")

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        result.message = "DATABASE_URL not set"
        return result

    try:
        import json

        from src.data_bridge import PostgresTrajectoryReader

        async with PostgresTrajectoryReader(database_url) as reader:
            windows = await reader.get_window_ids(min_agents=1, lookback_hours=168)
            if not windows:
                result.message = "No windows found"
                return result

            trajectories = await reader.get_trajectories_by_window(windows[0], min_actions=1)

        scores = []
        for traj in trajectories[:5]:  # Test first 5
            steps = json.loads(traj.steps_json)
            traj_data = {
                "trajectory_id": traj.trajectory_id,
                "final_pnl": traj.final_pnl or 0.0,
                "steps": steps,
            }
            score_result = test_rewards_on_trajectory(traj_data)
            scores.append(score_result)

        passed = sum(1 for s in scores if s["verdict"] == "PASS")

        result.passed = len(scores) > 0
        result.message = f"Tested {len(scores)} trajectories, {passed} passed"
        result.details = {
            "tested": len(scores),
            "passed": passed,
            "avg_composite": sum(s["composite_score"] for s in scores) / max(1, len(scores)),
        }

    except Exception as e:
        result.message = f"Failed: {e}"
        import traceback

        traceback.print_exc()

    return result


async def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Validate training pipeline")
    parser.add_argument(
        "--test-rewards", action="store_true", help="Also test reward functions on data"
    )
    args = parser.parse_args()

    print("=" * 70)
    print("  JEJU TRAINING PIPELINE - VALIDATION")
    print("=" * 70)
    print()

    # Run tests
    tests = [
        ("Environment Variables", test_environment_variables()),
        ("Database Connection", await test_database_connection()),
        ("Real Trajectory Data", await test_trajectory_data()),
        ("Data Conversion", await test_data_conversion()),
        ("Transformers Library", test_transformers()),
        ("MLX Backend", test_mlx_backend()),
        ("CUDA Backend", test_cuda_backend()),
    ]

    if args.test_rewards:
        tests.append(("Reward Functions", await test_reward_functions()))

    passed = 0
    failed = 0

    for _name, result in tests:
        status = "✓" if result.passed else "✗"
        print(f"{status} {result.name}")
        print(f"   {result.message}")
        if result.details:
            for k, v in result.details.items():
                print(f"   - {k}: {v}")
        print()

        if result.passed:
            passed += 1
        else:
            failed += 1

    # Summary
    print("=" * 70)
    print(f"  RESULTS: {passed} passed, {failed} failed")
    print("=" * 70)

    # Required checks
    required_tests = [
        "Environment Variables",
        "Database Connection",
        "Real Trajectory Data",
        "Data Conversion",
    ]
    required_passed = all(result.passed for _, result in tests if result.name in required_tests)

    if required_passed:
        print()
        print("All required checks passed!")
        print()
        print("Ready to train. Run:")
        print("  python scripts/train.py")
        print()
        return 0
    else:
        print()
        print("Some required checks failed. Fix issues before training.")
        print()
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
