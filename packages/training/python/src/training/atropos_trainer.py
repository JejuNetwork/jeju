"""
Babylon GRPO Trainer using Atropos

This trainer implements Group Relative Policy Optimization (GRPO) for
training Babylon trading agents using trajectories collected and scored
by the Babylon RLAIF Environment.

Key features:
- Pulls batches from Atropos API server
- Implements GRPO training loop with transformers/vLLM
- Supports checkpoint saving and vLLM model reloading
- Optional logging to file or console

Based on: https://github.com/NousResearch/atropos/blob/main/example_trainer/grpo.py
"""

import atexit
import json
import logging
import math
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
import torch
import torch.nn.functional as F
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_exponential
from torch.optim import AdamW
from transformers import AutoModelForCausalLM, AutoTokenizer

logger = logging.getLogger(__name__)

# Load environment variables
project_root = Path(__file__).parent.parent.parent.parent
env_path = project_root / ".env"
env_local_path = project_root / ".env.local"

if env_local_path.exists():
    load_dotenv(env_local_path, override=True)
if env_path.exists():
    load_dotenv(env_path, override=False)

# Global variable for vLLM process cleanup
vllm_process: subprocess.Popen | None = None


def cleanup_vllm():
    """Cleanup vLLM process on exit"""
    global vllm_process
    if vllm_process:
        logger.info("Terminating vLLM process...")
        vllm_process.terminate()
        try:
            vllm_process.wait(timeout=5)
            logger.info("vLLM process terminated.")
        except subprocess.TimeoutExpired:
            logger.warning("vLLM process did not terminate gracefully, killing.")
            vllm_process.kill()
            vllm_process.wait()
        vllm_process = None


atexit.register(cleanup_vllm)


class AtroposTrainingConfig(BaseModel):
    """Configuration for Atropos GRPO training"""

    # Model settings
    model_name: str = Field(default="Qwen/Qwen2.5-3B-Instruct", description="Base model to train")

    # Database settings (for trajectory loading)
    database_url: str | None = Field(default=None, description="PostgreSQL connection URL")

    # Training hyperparameters
    learning_rate: float = Field(default=1e-5, description="Learning rate")
    training_steps: int = Field(default=100, description="Number of training steps")
    batch_size: int = Field(default=4, description="Batch size per step")
    gradient_accumulation_steps: int = Field(default=8, description="Gradient accumulation steps")
    seq_len: int = Field(default=4096, description="Maximum sequence length")
    max_grad_norm: float = Field(default=1.0, description="Gradient clipping norm")

    # Device settings
    device: str = Field(
        default_factory=lambda: "cuda" if torch.cuda.is_available() else "cpu",
        description="Device to train on",
    )

    # vLLM settings
    vllm_port: int = Field(default=9001, description="Port for vLLM inference server")
    vllm_restart_interval: int = Field(default=5, description="Restart vLLM every N steps")
    vllm_gpu_utilization: float = Field(default=0.45, description="GPU memory for vLLM")

    # Checkpoint settings
    save_path: str = Field(default="./trained_models", description="Directory to save checkpoints")
    save_every_steps: int = Field(default=5, description="Save checkpoint every N steps")

    # Atropos API settings
    api_url: str = Field(default="http://localhost:8000", description="Atropos API URL")

    # Judge model for RLAIF scoring
    judge_model: str = Field(default="gpt-4o-mini", description="LLM model for scoring")

    # Data collection settings
    min_agents_per_window: int = Field(default=2, description="Minimum agents per window")
    lookback_hours: int = Field(default=72, description="Hours to look back for trajectories")

    # Logging settings
    log_to_file: bool = Field(default=True, description="Log metrics to file")
    log_file: str = Field(default="./logs/training_metrics.jsonl", description="Metrics log file")


class BabylonAtroposTrainer:
    """
    GRPO Trainer for Babylon using Atropos

    This trainer:
    1. Registers with Atropos API server
    2. Pulls batches of scored trajectories
    3. Trains using GRPO (Group Relative Policy Optimization)
    4. Periodically saves checkpoints and restarts vLLM
    """

    def __init__(self, config: AtroposTrainingConfig):
        self.config = config
        self.model: AutoModelForCausalLM | None = None
        self.tokenizer: AutoTokenizer | None = None
        self.optimizer: AdamW | None = None
        self.current_step: int = 0
        self.vllm_process: subprocess.Popen | None = None
        self.run_id: str = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    def setup(self):
        """Initialize model, tokenizer, and optimizer"""
        logger.info(f"Loading model: {self.config.model_name}")

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.config.model_name, trust_remote_code=True
        )

        self.model = AutoModelForCausalLM.from_pretrained(
            self.config.model_name, torch_dtype=torch.bfloat16, trust_remote_code=True
        )

        assert self.model is not None, "Failed to load model"
        self.model.to(self.config.device)
        self.model.gradient_checkpointing_enable()
        self.model.train()

        self.optimizer = AdamW(self.model.parameters(), lr=self.config.learning_rate)

        logger.info(f"Model loaded on {self.config.device}")

    def setup_logging(self):
        """Initialize metrics logging"""
        if self.config.log_to_file:
            log_dir = Path(self.config.log_file).parent
            log_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Metrics will be logged to: {self.config.log_file}")

    def log_metrics(self, metrics: dict, step: int):
        """Log metrics to file"""
        if self.config.log_to_file:
            metrics_entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "run_id": self.run_id,
                "step": step,
                **metrics,
            }
            with open(self.config.log_file, "a") as f:
                f.write(json.dumps(metrics_entry) + "\n")

    @retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=2, max=30))
    def register_with_api(self):
        """Register trainer with Atropos API"""
        logger.info(f"Registering with Atropos API at {self.config.api_url}")

        response = requests.post(
            f"{self.config.api_url}/register",
            json={
                "run_id": self.run_id,
                "batch_size": self.config.batch_size * self.config.gradient_accumulation_steps,
                "max_token_len": self.config.seq_len,
                "starting_step": self.current_step,
                "checkpoint_dir": self.config.save_path,
                "save_checkpoint_interval": self.config.save_every_steps,
                "num_steps": self.config.training_steps,
            },
            timeout=30,
        )
        response.raise_for_status()

        result = response.json()
        logger.info(f"Registered with API: {result}")
        return result

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    def get_batch(self) -> list | None:
        """Get next batch from Atropos API"""
        response = requests.get(f"{self.config.api_url}/batch", timeout=30)
        response.raise_for_status()

        data = response.json()
        return data.get("batch")

    def start_vllm(self, model_path: str | None = None):
        """Start vLLM inference server"""
        global vllm_process

        # Terminate existing process
        if self.vllm_process:
            logger.info("Terminating existing vLLM process...")
            self.vllm_process.terminate()
            try:
                self.vllm_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.vllm_process.kill()
                self.vllm_process.wait()
            self.vllm_process = None

        # Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        model_to_load = model_path or self.config.model_name

        cmd = [
            "python",
            "-m",
            "vllm.entrypoints.openai.api_server",
            "--model",
            model_to_load,
            "--port",
            str(self.config.vllm_port),
            "--dtype",
            "auto",
            "--gpu-memory-utilization",
            str(self.config.vllm_gpu_utilization),
            "--disable-log-requests",
            "--served-model-name",
            self.config.model_name,
        ]

        logger.info(f"Starting vLLM: {' '.join(cmd)}")

        try:
            self.vllm_process = subprocess.Popen(cmd)
            vllm_process = self.vllm_process  # Update global for cleanup

            logger.info(f"vLLM started with PID: {self.vllm_process.pid}")

            # Wait for server to be ready with health check
            self._wait_for_vllm_ready()

        except Exception as e:
            logger.error(f"Failed to start vLLM: {e}")
            self.vllm_process = None

    def _wait_for_vllm_ready(self, timeout: int = 120, poll_interval: float = 2.0):
        """Wait for vLLM server to be ready, with health checks"""
        vllm_url = f"http://localhost:{self.config.vllm_port}/health"
        start_time = time.time()

        logger.info(f"Waiting for vLLM server to be ready (timeout: {timeout}s)...")

        while time.time() - start_time < timeout:
            # Check if process died
            if self.vllm_process and self.vllm_process.poll() is not None:
                raise RuntimeError(f"vLLM process died with code {self.vllm_process.returncode}")

            try:
                response = requests.get(vllm_url, timeout=5)
                if response.status_code == 200:
                    logger.info("vLLM server is ready!")
                    return
            except requests.exceptions.ConnectionError:
                pass  # Server not ready yet
            except requests.exceptions.Timeout:
                pass  # Server busy loading

            time.sleep(poll_interval)

        raise TimeoutError(f"vLLM server did not become ready within {timeout} seconds")

    def prepare_batch(self, batch_data: list) -> tuple[list, list, list, list]:
        """
        Prepare batch data for GRPO training

        Returns:
            token_batches: List of token tensors
            label_batches: List of label tensors (with -100 for non-trainable tokens)
            advantage_batches: List of advantage tensors
            temperature_batches: List of temperature tensors
        """
        max_token_len = 0
        for item in batch_data:
            for tokens in item.get("tokens", []):
                max_token_len = max(max_token_len, len(tokens))

        # Pad to multiple of 64 for efficiency
        good_multiple = 64
        if (max_token_len - 1) % good_multiple != 0:
            max_token_len = math.ceil((max_token_len - 1) / good_multiple) * good_multiple + 1

        input_ids_list = []
        labels_list = []
        advantages_list = []
        temperatures_list = []

        for item in batch_data:
            scores = np.array(item.get("scores", [0.0]))

            # Normalize scores within group
            if len(scores) > 1:
                scores = scores - scores.mean()
                std = scores.std()
                if std > 1e-8:
                    scores = scores / std

            tokens_list = item.get("tokens", [])
            masks_list = item.get("masks", [])

            for i in range(len(tokens_list)):
                tokens = np.array(tokens_list[i])
                masks = np.array(masks_list[i])
                score = scores[i] if i < len(scores) else 0.0

                # Pad tokens and masks
                pad_length = max(0, max_token_len - len(tokens))

                padded_tokens = np.concatenate([tokens, np.zeros(pad_length, dtype=np.int32)])
                padded_masks = np.concatenate([masks, np.full(pad_length, -100, dtype=np.int32)])

                # Create input_ids (all but last) and labels (all but first, shifted)
                input_ids_list.append(padded_tokens[:-1])
                labels_list.append(padded_masks[1:])
                advantages_list.append(score)

                # Get temperature from overrides or default to 1.0
                temp = 1.0
                overrides = item.get("overrides")
                if overrides and i < len(overrides) and isinstance(overrides[i], dict):
                    temp = float(overrides[i].get("temperature", 1.0))
                elif item.get("generation_params"):
                    temp = float(item["generation_params"].get("temperature", 1.0))
                temperatures_list.append(temp)

        # Split into batches
        batch_size = self.config.batch_size
        token_batches = []
        label_batches = []
        advantage_batches = []
        temperature_batches = []

        num_batches = len(input_ids_list) // batch_size

        for i in range(num_batches):
            start = i * batch_size
            end = start + batch_size

            token_batches.append(torch.tensor(np.stack(input_ids_list[start:end])))
            label_batches.append(torch.tensor(np.stack(labels_list[start:end])))
            advantage_batches.append(
                torch.tensor(advantages_list[start:end], dtype=torch.float32).view(-1, 1)
            )
            temperature_batches.append(
                torch.tensor(temperatures_list[start:end], dtype=torch.float32).view(-1, 1, 1)
            )

        return token_batches, label_batches, advantage_batches, temperature_batches

    def train_step(
        self,
        token_batches: list[torch.Tensor],
        label_batches: list[torch.Tensor],
        advantage_batches: list[torch.Tensor],
        temperature_batches: list[torch.Tensor],
    ) -> dict:
        """Execute one GRPO training step"""
        assert self.model is not None
        assert self.optimizer is not None

        total_loss = 0.0
        total_pos_logp = 0.0
        total_neg_logp = 0.0
        total_pos = 0
        total_neg = 0

        for tokens, labels, advantages, temperatures in zip(
            token_batches, label_batches, advantage_batches, temperature_batches, strict=False
        ):
            tokens = tokens.to(self.config.device)
            labels = labels.to(self.config.device)
            advantages = advantages.to(self.config.device)

            # Forward pass
            outputs = self.model(tokens)
            logits = outputs.logits

            # Temperature scaling
            t = temperatures.to(logits.device, logits.dtype)
            t = torch.where(t <= 0, torch.ones_like(t), t)
            logits = logits / t

            # Calculate log probabilities
            logp_per_token = -F.cross_entropy(
                logits.view(-1, logits.size(-1)),
                labels.view(-1),
                reduction="none",
                ignore_index=-100,
            ).view(labels.shape)

            # Create mask for trainable tokens
            mask = (labels != -100).float()

            with torch.no_grad():
                pos = (advantages > 0).float()
                neg = (advantages <= 0).float()
                mask_sum = mask.sum(dim=-1).clamp_min(1e-8)

                avg_logp = (logp_per_token * mask).sum(dim=-1) / mask_sum
                pos_logp = (avg_logp * pos.squeeze(-1)).sum().item()
                neg_logp = (avg_logp * neg.squeeze(-1)).sum().item()

                total_pos_logp += pos_logp
                total_neg_logp += neg_logp
                total_pos += pos.sum().item()
                total_neg += neg.sum().item()

            # GRPO loss calculation
            grpo_loss_term = torch.exp(logp_per_token - logp_per_token.detach())
            grpo_loss = (
                ((-grpo_loss_term * mask).sum(-1) / mask.sum(-1))
                * advantages.to(logp_per_token.device).squeeze(-1)
            ).mean() / self.config.gradient_accumulation_steps

            grpo_loss.backward()
            total_loss += grpo_loss.item()

        # Gradient clipping and optimizer step
        grad_norm = torch.nn.utils.clip_grad_norm_(
            self.model.parameters(), max_norm=self.config.max_grad_norm
        )

        self.optimizer.step()
        self.optimizer.zero_grad()

        # Normalize metrics
        if total_pos > 0:
            total_pos_logp /= total_pos
        if total_neg > 0:
            total_neg_logp /= total_neg

        return {
            "loss": total_loss,
            "grad_norm": grad_norm.item(),
            "pos_logp": total_pos_logp,
            "neg_logp": total_neg_logp,
            "total_pos": total_pos,
            "total_neg": total_neg,
        }

    def save_checkpoint(self, step: int, is_final: bool = False):
        """Save model checkpoint"""
        assert self.model is not None
        assert self.tokenizer is not None

        checkpoint_name = "final_model" if is_final else f"step_{step}"
        checkpoint_path = os.path.join(self.config.save_path, checkpoint_name)

        # Remove existing checkpoint
        if os.path.exists(checkpoint_path):
            shutil.rmtree(checkpoint_path)

        os.makedirs(checkpoint_path, exist_ok=True)

        self.model.save_pretrained(checkpoint_path)
        self.tokenizer.save_pretrained(checkpoint_path)

        logger.info(f"Checkpoint saved: {checkpoint_path}")
        return checkpoint_path

    async def train(self, steps: int | None = None, batch_size: int | None = None) -> dict:
        """Main training loop (async interface for compatibility)"""
        if steps:
            self.config.training_steps = steps
        if batch_size:
            self.config.batch_size = batch_size

        return self._train_sync()

    def _train_sync(self) -> dict:
        """Synchronous training loop"""
        logger.info(f"Starting training for {self.config.training_steps} steps")

        # Setup
        self.setup()
        self.setup_logging()
        self.register_with_api()

        # Start vLLM
        self.start_vllm()

        # Create save directory
        os.makedirs(self.config.save_path, exist_ok=True)

        batches_buffer: list = []
        all_metrics: list[dict] = []

        for step in range(self.config.training_steps):
            self.current_step = step + 1
            logger.info(f"Step {self.current_step}/{self.config.training_steps}")

            # Get batch data
            while not batches_buffer:
                batch = self.get_batch()
                if batch:
                    batches_buffer = batch if isinstance(batch, list) else [batch]
                else:
                    logger.info("Waiting for batch data...")
                    time.sleep(2)

            # Prepare batch
            batch_data = batches_buffer.pop(0) if batches_buffer else []
            if not isinstance(batch_data, list):
                batch_data = [batch_data]

            token_batches, label_batches, advantage_batches, temperature_batches = (
                self.prepare_batch(batch_data)
            )

            if not token_batches:
                logger.warning("Empty batch, skipping step")
                continue

            # Train step
            metrics = self.train_step(
                token_batches, label_batches, advantage_batches, temperature_batches
            )

            logger.info(f"  Loss: {metrics['loss']:.4f}, Grad norm: {metrics['grad_norm']:.4f}")

            # Log metrics
            self.log_metrics(
                {
                    "train/loss": metrics["loss"],
                    "train/grad_norm": metrics["grad_norm"],
                    "train/pos_logp": metrics["pos_logp"],
                    "train/neg_logp": metrics["neg_logp"],
                },
                self.current_step,
            )

            all_metrics.append(metrics)

            # Checkpoint and vLLM restart
            should_checkpoint = (
                self.current_step % self.config.vllm_restart_interval == 0
                or self.current_step == self.config.training_steps
            )

            if should_checkpoint:
                checkpoint_path = self.save_checkpoint(self.current_step)

                # Restart vLLM with new weights
                if self.current_step < self.config.training_steps:
                    self.start_vllm(checkpoint_path)

        # Final save
        final_checkpoint = self.save_checkpoint(self.current_step, is_final=True)

        logger.info("Training complete!")

        return {
            "steps": self.current_step,
            "final_checkpoint": final_checkpoint,
            "metrics": all_metrics,
        }


def main():
    """CLI entry point"""
    import argparse

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )

    parser = argparse.ArgumentParser(description="Babylon GRPO Trainer with Atropos")
    parser.add_argument("--model", default="Qwen/Qwen2.5-3B-Instruct", help="Model to train")
    parser.add_argument("--steps", type=int, default=100, help="Training steps")
    parser.add_argument("--batch-size", type=int, default=4, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--save-path", default="./trained_models", help="Checkpoint directory")
    parser.add_argument("--api-url", default="http://localhost:8000", help="Atropos API URL")
    parser.add_argument("--vllm-port", type=int, default=9001, help="vLLM server port")
    parser.add_argument(
        "--log-file", default="./logs/training_metrics.jsonl", help="Metrics log file"
    )

    args = parser.parse_args()

    config = AtroposTrainingConfig(
        model_name=args.model,
        training_steps=args.steps,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        save_path=args.save_path,
        api_url=args.api_url,
        vllm_port=args.vllm_port,
        log_file=args.log_file,
    )

    trainer = BabylonAtroposTrainer(config)
    trainer._train_sync()


if __name__ == "__main__":
    main()
