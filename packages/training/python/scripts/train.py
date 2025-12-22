#!/usr/bin/env python3
"""
Jeju Training Script - Local Training for MLX (Apple Silicon) + CUDA (NVIDIA)

Trains models using real trajectory data from PostgreSQL database or local JSON files.
Only trajectories with actual LLM calls are used for training.

Supports:
- Apple Silicon (MLX) - LoRA fine-tuning
- NVIDIA GPU (PyTorch/CUDA) - Full or LoRA fine-tuning  
- CPU fallback (slow but works)

Usage:
    # Mac with MLX from Postgres Database
    python scripts/train.py --backend mlx --model mlx-community/Qwen2.5-1.5B-Instruct-4bit
    
    # Mac with MLX from local JSON files
    python scripts/train.py --backend mlx --source-dir ./data/trajectories
    
    # NVIDIA GPU from Postgres Database
    python scripts/train.py --backend cuda --model Qwen/Qwen2.5-1.5B-Instruct
    
    # From CSV file (pre-processed data)
    python scripts/train.py --backend cuda --csv ./data/scored_trajectories.csv

Model recommendations for consumer hardware:
    Mac M1/M2 (8GB):   mlx-community/Qwen2.5-0.5B-Instruct-4bit
    Mac M1/M2 (16GB):  mlx-community/Qwen2.5-1.5B-Instruct-4bit
    GTX 3060 (12GB):   Qwen/Qwen2.5-1.5B-Instruct
    GTX 3080 (10GB):   Qwen/Qwen2.5-1.5B-Instruct
    GTX 4090 (24GB):   Qwen/Qwen2.5-3B-Instruct
"""

import argparse
import asyncio
import json
import logging
import os
import random
import subprocess
import sys
from pathlib import Path
from typing import Literal

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

from src.models import BabylonTrajectory
from src.data_bridge.reader import JsonTrajectoryReader, PostgresTrajectoryReader, validate_llm_calls

# Load environment
env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)


def detect_backend() -> Literal["mlx", "cuda", "cpu"]:
    """Auto-detect the best available backend."""
    try:
        import mlx.core  # type: ignore
        logger.info("MLX backend available (Apple Silicon)")
        return "mlx"
    except ImportError:
        pass

    try:
        import torch
        if torch.cuda.is_available():
            logger.info(f"CUDA backend available: {torch.cuda.get_device_name(0)}")
            return "cuda"
    except ImportError:
        pass

    logger.warning("No GPU backend available, falling back to CPU (slow)")
    return "cpu"


async def load_postgres_data(
    database_url: str,
    min_actions: int,
    lookback_hours: int,
    max_trajectories: int,
) -> list[BabylonTrajectory]:
    """Load training data from PostgreSQL database."""
    logger.info("Loading training data from database...")

    trajectories: list[BabylonTrajectory] = []

    async with PostgresTrajectoryReader(database_url) as reader:
        windows = await reader.get_window_ids(lookback_hours=lookback_hours)
        if not windows:
            raise ValueError("No trajectory windows found in database. Generate data first.")

        logger.info(f"Found {len(windows)} trajectory windows")

        for window_id in windows:
            if len(trajectories) >= max_trajectories:
                break

            window_trajectories = await reader.get_trajectories_by_window(
                window_id, min_actions=min_actions, validate=True
            )
            for traj_row in window_trajectories:
                steps = json.loads(traj_row.steps_json)
                traj_data = {
                    "id": traj_row.trajectory_id,
                    "trajectory_id": traj_row.trajectory_id,
                    "agent_id": traj_row.agent_id,
                    "window_id": traj_row.window_id,
                    "steps": steps,
                    "total_reward": traj_row.total_reward,
                    "episode_length": traj_row.episode_length,
                    "final_status": traj_row.final_status,
                    "final_pnl": traj_row.final_pnl,
                    "trades_executed": traj_row.trades_executed,
                    "archetype": traj_row.archetype,
                }
                trajectories.append(BabylonTrajectory.model_validate(traj_data))

    if len(trajectories) < 10:
        raise ValueError(f"Insufficient training data: only {len(trajectories)} valid trajectories found.")

    logger.info(f"Loaded {len(trajectories)} trajectories from database")
    return trajectories


def load_json_data(source_dir: str, max_trajectories: int) -> list[BabylonTrajectory]:
    """Load training data from local JSON files."""
    logger.info(f"Loading training data from: {source_dir}")
    
    reader = JsonTrajectoryReader(source_dir)
    trajectories: list[BabylonTrajectory] = []
    
    for window_id in reader.get_window_ids():
        if len(trajectories) >= max_trajectories:
            break
        for traj_data in reader.get_trajectories_by_window(window_id):
            # Handle nested trajectory key and stepsJson string format
            if 'trajectory' in traj_data:
                traj_data = traj_data['trajectory']
            if 'stepsJson' in traj_data and isinstance(traj_data['stepsJson'], str):
                traj_data['steps'] = json.loads(traj_data['stepsJson'])

            is_valid, _ = validate_llm_calls(traj_data.get('steps', []))
            if not is_valid:
                continue

            if 'id' not in traj_data:
                traj_data['id'] = traj_data.get('trajectory_id', 'id_missing')

            trajectories.append(BabylonTrajectory.model_validate(traj_data))

    if len(trajectories) == 0:
        raise ValueError("No valid trajectories found in JSON files.")

    logger.info(f"Loaded {len(trajectories)} trajectories from JSON files")
    return trajectories


def load_csv_data(csv_path: str) -> list[dict]:
    """Load pre-processed training data from CSV."""
    import pandas as pd
    
    logger.info(f"Loading training data from CSV: {csv_path}")
    df = pd.read_csv(csv_path)
    
    # Filter for high quality data
    if 'score' in df.columns:
        df = df[df['score'] > 0.7].copy()
        logger.info(f"Filtered to {len(df)} high-quality samples")
    
    samples = []
    for _, row in df.iterrows():
        messages = []
        if 'system' in row and pd.notna(row['system']):
            messages.append({"role": "system", "content": str(row['system'])})
        if 'prompt' in row and pd.notna(row['prompt']):
            messages.append({"role": "user", "content": str(row['prompt'])})
        if 'response' in row and pd.notna(row['response']):
            messages.append({"role": "assistant", "content": str(row['response'])})
        
        if len(messages) >= 2:
            samples.append({"messages": messages})
    
    logger.info(f"Loaded {len(samples)} training samples from CSV")
    return samples


def trajectories_to_samples(trajectories: list[BabylonTrajectory]) -> list[dict]:
    """Convert trajectories to training samples."""
    samples = []
    for traj in trajectories:
        for step in traj.steps:
            if not step.llm_calls:
                continue
            for llm_call in step.llm_calls:
                if not llm_call.response or len(llm_call.response) < 20:
                    continue

                messages = []
                if llm_call.system_prompt:
                    messages.append({"role": "system", "content": llm_call.system_prompt})
                if llm_call.user_prompt:
                    messages.append({"role": "user", "content": llm_call.user_prompt})
                messages.append({"role": "assistant", "content": llm_call.response})

                if len(messages) >= 2:
                    samples.append({"messages": messages})

    logger.info(f"Converted {len(trajectories)} trajectories to {len(samples)} training samples")
    return samples


def train_mlx(
    samples: list[dict], 
    model_name: str, 
    output_dir: str,
    num_iters: int, 
    batch_size: int, 
    learning_rate: float
) -> str:
    """Train using MLX LoRA on Apple Silicon."""
    logger.info("=" * 60)
    logger.info("MLX LORA TRAINING")
    logger.info("=" * 60)
    
    data_dir = os.path.join(output_dir, "training_data")
    os.makedirs(data_dir, exist_ok=True)

    random.shuffle(samples)
    split_idx = int(len(samples) * 0.9)
    train_samples, valid_samples = samples[:split_idx], samples[split_idx:]

    with open(os.path.join(data_dir, "train.jsonl"), 'w') as f:
        for s in train_samples:
            f.write(json.dumps(s) + "\n")
    with open(os.path.join(data_dir, "valid.jsonl"), 'w') as f:
        for s in valid_samples:
            f.write(json.dumps(s) + "\n")

    adapter_path = os.path.join(output_dir, "adapters")
    
    cmd = [
        sys.executable, "-m", "mlx_lm", "lora",
        "--model", model_name,
        "--train",
        "--data", data_dir,
        "--adapter-path", adapter_path,
        "--batch-size", str(batch_size),
        "--iters", str(num_iters),
        "--learning-rate", str(learning_rate),
        "--steps-per-report", "10",
        "--steps-per-eval", "25",
        "--val-batches", "5",
        "--max-seq-length", "1024",
        "--num-layers", "8",
        "--mask-prompt",
    ]
    
    logger.info(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    
    return adapter_path


def train_cuda(
    samples: list[dict], 
    model_name: str, 
    output_dir: str,
    epochs: int, 
    batch_size: int, 
    learning_rate: float, 
    use_lora: bool
) -> str:
    """Train using PyTorch/CUDA on NVIDIA GPU."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer, DataCollatorForLanguageModeling
    from datasets import Dataset

    logger.info("=" * 60)
    logger.info("CUDA/PYTORCH TRAINING")
    logger.info("=" * 60)
    logger.info(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    formatted = [
        {"text": tokenizer.apply_chat_template(s['messages'], tokenize=False, add_generation_prompt=False)} 
        for s in samples if s.get("messages")
    ]
    dataset = Dataset.from_list(formatted)

    def tokenize_fn(examples: dict) -> dict:
        return tokenizer(
            examples["text"],
            truncation=True,
            max_length=1024,
            padding="max_length",
        )

    tokenized = dataset.map(tokenize_fn, batched=True, remove_columns=["text"])

    model = AutoModelForCausalLM.from_pretrained(
        model_name, 
        torch_dtype=torch.float16, 
        trust_remote_code=True, 
        device_map="auto"
    )

    if use_lora:
        from peft import LoraConfig, get_peft_model, TaskType
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM, 
            r=16, 
            lora_alpha=32,
            lora_dropout=0.1, 
            target_modules=["q_proj", "v_proj", "k_proj", "o_proj"]
        )
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=learning_rate,
        warmup_steps=100,
        logging_steps=10,
        save_steps=500,
        save_total_limit=2,
        fp16=True,
        report_to="none",
        remove_unused_columns=False
    )

    trainer = Trainer(
        model=model, 
        args=training_args, 
        train_dataset=tokenized,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)
    )

    trainer.train()
    trainer.save_model(output_dir)
    return output_dir


def train_cpu(
    samples: list[dict], 
    model_name: str, 
    output_dir: str, 
    epochs: int, 
    learning_rate: float
) -> str:
    """Train using CPU (slow fallback)."""
    logger.warning("=" * 60)
    logger.warning("CPU TRAINING (VERY SLOW)")
    logger.warning("=" * 60)
    # Use smaller model for CPU
    return train_cuda(samples, "Qwen/Qwen2.5-0.5B-Instruct", output_dir, epochs, 1, learning_rate, use_lora=False)


def validate_model(
    model_path: str, 
    backend: Literal["mlx", "cuda", "cpu"], 
    base_model: str | None = None
) -> bool:
    """Validate trained model by generating a test response."""
    logger.info("=" * 60)
    logger.info("VALIDATING TRAINED MODEL")
    logger.info("=" * 60)
    
    test_prompt = """You are a trading agent in prediction markets.

Current State:
- Balance: $10,000
- P&L: $250
- Positions: 2 open

Market Update:
- BTC prediction market at 68% probability
- Recent news: Fed announces rate cut consideration

Analyze this market update and explain your trading decision."""

    if backend == "mlx":
        from mlx_lm import load, generate  # type: ignore
        model, tokenizer = load(base_model, adapter_path=model_path)
        messages = [{"role": "user", "content": test_prompt}]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        response = generate(model, tokenizer, prompt=prompt, max_tokens=200, verbose=False)
    else:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            torch_dtype=torch.float16 if backend == "cuda" else torch.float32,
            device_map="auto" if backend == "cuda" else None,
            trust_remote_code=True,
        )
        messages = [{"role": "user", "content": test_prompt}]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(prompt, return_tensors="pt")
        if backend == "cuda":
            inputs = {k: v.cuda() for k, v in inputs.items()}
        outputs = model.generate(
            **inputs, 
            max_new_tokens=200, 
            temperature=0.7,
            do_sample=True, 
            pad_token_id=tokenizer.eos_token_id
        )
        response = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)

    logger.info(f"Test Response:\n{'-' * 40}\n{response[:500]}...\n{'-' * 40}")

    if len(response) < 50:
        logger.error("Response too short - model may not be working")
        return False

    logger.info("Model validation passed")
    return True


async def main_async(args: argparse.Namespace) -> int:
    """Main training function."""
    backend = args.backend or detect_backend()
    model_name = args.model or (
        "mlx-community/Qwen2.5-1.5B-Instruct-4bit" if backend == "mlx" else "Qwen/Qwen2.5-1.5B-Instruct"
    )
    
    logger.info(f"Backend: {backend}, Model: {model_name}")
    os.makedirs(args.output, exist_ok=True)

    # Load data based on source
    if args.csv:
        samples = load_csv_data(args.csv)
    elif args.source_dir:
        trajectories = load_json_data(args.source_dir, args.max_trajectories)
        samples = trajectories_to_samples(trajectories)
    else:
        database_url = args.database_url or os.getenv("DATABASE_URL")
        if not database_url:
            logger.error("DATABASE_URL not set and --source-dir/--csv not provided")
            return 1
        trajectories = await load_postgres_data(
            database_url, args.min_actions, args.lookback_hours, args.max_trajectories
        )
        samples = trajectories_to_samples(trajectories)

    if len(samples) < 10:
        logger.error(f"Not enough training samples: {len(samples)}")
        return 1

    # Train
    model_path = ""
    base_model: str | None = None
    
    if backend == "mlx":
        model_path = train_mlx(samples, model_name, args.output, args.iters, args.batch_size, args.lr)
        base_model = model_name
    elif backend == "cuda":
        model_path = train_cuda(samples, model_name, args.output, args.epochs, args.batch_size, args.lr, args.lora)
    else:
        model_path = train_cpu(samples, model_name, args.output, args.epochs, args.lr)

    # Validate
    if args.validate and model_path:
        validate_model(model_path, backend, base_model)

    logger.info("=" * 60)
    logger.info("TRAINING COMPLETE")
    logger.info(f"Model saved to: {model_path}")
    logger.info("=" * 60)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Jeju Local Training",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    # Data sources (mutually exclusive)
    source_group = parser.add_mutually_exclusive_group()
    source_group.add_argument("--source-dir", help="Directory with local JSON trajectory files")
    source_group.add_argument("--csv", help="Path to pre-processed CSV training data")
    source_group.add_argument("--database-url", help="PostgreSQL database URL")

    # Backend and model
    parser.add_argument("--backend", choices=["mlx", "cuda", "cpu"], help="Training backend (auto-detected if not specified)")
    parser.add_argument("--model", help="Model to train (default depends on backend)")

    # Data loading options
    parser.add_argument("--min-actions", type=int, default=3, help="Minimum actions per trajectory")
    parser.add_argument("--lookback-hours", type=int, default=168, help="Hours to look back for trajectories")
    parser.add_argument("--max-trajectories", type=int, default=500, help="Maximum trajectories to load")

    # Training options
    parser.add_argument("--output", default="./trained_models", help="Output directory")
    parser.add_argument("--iters", type=int, default=100, help="Training iterations (MLX)")
    parser.add_argument("--epochs", type=int, default=3, help="Training epochs (CUDA/CPU)")
    parser.add_argument("--batch-size", type=int, default=2, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--lora", action=argparse.BooleanOptionalAction, default=True, help="Use LoRA (CUDA only)")
    parser.add_argument("--validate", action=argparse.BooleanOptionalAction, default=True, help="Validate trained model")

    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
