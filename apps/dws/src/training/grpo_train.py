#!/usr/bin/env python3
"""
Real GRPO Trainer for Jeju DWS

Implements actual gradient descent with PyTorch for GRPO training.
Uses vLLM for inference and integrates with Atropos for coordination.
"""

import argparse
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import bitsandbytes as bnb
import requests
import torch
import torch.nn.functional as F
from transformers import AutoModelForCausalLM, AutoTokenizer

# ============================================================================
# Configuration
# ============================================================================


@dataclass
class TrainingConfig:
    # Use TinyLlama-1.1B - fits in 16GB with gradients
    model_name: str = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
    learning_rate: float = 5e-6  # Lower LR for stability
    training_steps: int = 20
    batch_size: int = 1
    max_seq_len: int = 512
    gradient_accumulation_steps: int = 4
    group_size: int = 8  # More samples per prompt for better advantage estimation
    save_path: str = "./training_checkpoints"
    atropos_url: str = "http://localhost:8000"
    vllm_port: int = 9001
    vllm_restart_interval: int = 10
    use_wandb: bool = False
    wandb_project: str = "jeju-grpo"
    device: str = "cuda" if torch.cuda.is_available() else "cpu"


# ============================================================================
# vLLM Process Manager
# ============================================================================


class VLLMServer:
    def __init__(self, model_path: str, port: int = 9001):
        self.model_path = model_path
        self.port = port
        self.process: subprocess.Popen | None = None

    def start(self):
        if self.process is not None:
            self.stop()

        print(f"[vLLM] Starting server for {self.model_path} on port {self.port}")

        cmd = [
            sys.executable,
            "-m",
            "vllm.entrypoints.openai.api_server",
            "--model",
            self.model_path,
            "--port",
            str(self.port),
            "--dtype",
            "float16",
            "--gpu-memory-utilization",
            "0.35",
            "--max-model-len",
            "512",
            "--enforce-eager",
        ]

        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        # Wait for server to be ready
        for i in range(120):
            try:
                r = requests.get(f"http://localhost:{self.port}/health", timeout=1)
                if r.ok:
                    print(f"[vLLM] Server ready on port {self.port}")
                    return
            except Exception:
                pass
            time.sleep(1)
            if i % 10 == 0:
                print(f"[vLLM] Still starting... ({i}s)")

        raise RuntimeError("vLLM server failed to start")

    def stop(self):
        if self.process is not None:
            print("[vLLM] Stopping server")
            self.process.terminate()
            self.process.wait(timeout=30)
            self.process = None

    def generate(self, prompt: str, max_tokens: int = 256, temperature: float = 0.8) -> str:
        response = requests.post(
            f"http://localhost:{self.port}/v1/completions",
            json={
                "model": self.model_path.split("/")[-1],
                "prompt": prompt,
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["text"]


# ============================================================================
# Atropos Client
# ============================================================================


class AtroposClient:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url

    def register_trainer(self, config: TrainingConfig) -> str:
        response = requests.post(
            f"{self.base_url}/register",
            json={
                "wandb_group": "jeju-grpo",
                "wandb_project": config.wandb_project,
                "batch_size": config.batch_size * config.gradient_accumulation_steps,
                "max_token_len": config.max_seq_len,
                "checkpoint_dir": config.save_path,
                "save_checkpoint_interval": config.vllm_restart_interval,
                "starting_step": 0,
                "num_steps": config.training_steps,
            },
            timeout=10,
        )
        response.raise_for_status()
        return response.json().get("uuid", "trainer")

    def get_batch(self):
        response = requests.get(f"{self.base_url}/batch", timeout=10)
        response.raise_for_status()
        data = response.json()
        return data.get("batch")

    def submit_scored_data(self, tokens, masks, scores, env_id: int = 0):
        response = requests.post(
            f"{self.base_url}/scored_data",
            json={
                "tokens": tokens,
                "masks": masks,
                "scores": scores,
                "env_id": env_id,
            },
            timeout=10,
        )
        response.raise_for_status()

    def get_status(self):
        response = requests.get(f"{self.base_url}/status", timeout=10)
        response.raise_for_status()
        return response.json()


# ============================================================================
# GRPO Loss Computation
# ============================================================================


def compute_grpo_loss(
    model: torch.nn.Module,
    input_ids: torch.Tensor,
    labels: torch.Tensor,
    advantages: torch.Tensor,
    temperature: float = 1.0,
) -> tuple[torch.Tensor, dict]:
    """
    Compute GRPO loss with actual gradient computation.

    GRPO objective: maximize log_prob for positive advantages, minimize for negative.
    Loss = -E[advantage * log_prob]

    For positive advantage (good response): we want high log_prob, so loss goes down
    For negative advantage (bad response): we want low log_prob, so gradient pushes down
    """
    # Forward pass
    outputs = model(input_ids, use_cache=False)
    logits = outputs.logits

    # Apply temperature
    logits = logits / temperature

    # Shift for causal LM (predict next token)
    shift_logits = logits[..., :-1, :].contiguous()
    shift_labels = labels[..., 1:].contiguous()

    # Compute per-token log probabilities
    log_probs = F.log_softmax(shift_logits, dim=-1)

    # Gather log probs for actual tokens
    token_log_probs = torch.gather(
        log_probs, dim=-1, index=shift_labels.unsqueeze(-1).clamp(min=0)
    ).squeeze(-1)

    # Mask out padding/ignored tokens (labels == -100)
    mask = (shift_labels != -100).float()

    # Sum log prob per sequence (more stable than mean for short sequences)
    seq_log_probs = (token_log_probs * mask).sum(dim=-1)

    # Normalize by sequence length for comparability
    seq_lengths = mask.sum(dim=-1).clamp(min=1)
    normalized_log_probs = seq_log_probs / seq_lengths

    # GRPO loss: we want to maximize advantage-weighted log probs
    # Loss = -E[advantage * normalized_log_prob]
    policy_loss = -(advantages * normalized_log_probs).mean()

    # Add entropy bonus for exploration (prevents collapse)
    entropy = -(log_probs.exp() * log_probs).sum(dim=-1).mean()
    entropy_bonus = 0.01 * entropy

    loss = policy_loss - entropy_bonus

    # Compute metrics
    with torch.no_grad():
        pos_mask = advantages > 0
        neg_mask = advantages <= 0

        metrics = {
            "loss": loss.item(),
            "policy_loss": policy_loss.item(),
            "entropy": entropy.item(),
            "mean_log_prob": normalized_log_probs.mean().item(),
            "pos_log_prob": normalized_log_probs[pos_mask].mean().item() if pos_mask.any() else 0.0,
            "neg_log_prob": normalized_log_probs[neg_mask].mean().item() if neg_mask.any() else 0.0,
            "mean_advantage": advantages.mean().item(),
            "pos_count": pos_mask.sum().item(),
            "neg_count": neg_mask.sum().item(),
        }

    return loss, metrics


# ============================================================================
# Training Loop
# ============================================================================


class GRPOTrainer:
    def __init__(self, config: TrainingConfig):
        self.config = config
        self.device = torch.device(config.device)

        print(f"[GRPO] Loading model {config.model_name}")
        self.tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        self.model = AutoModelForCausalLM.from_pretrained(
            config.model_name,
            torch_dtype=torch.float16,
        ).to(self.device)
        self.model.gradient_checkpointing_enable()

        # Use 8-bit Adam to save memory
        self.optimizer = bnb.optim.Adam8bit(
            self.model.parameters(),
            lr=config.learning_rate,
            weight_decay=0.01,
        )

        self.atropos = AtroposClient(config.atropos_url)

        self.current_step = 0
        self.checkpoint_path = Path(config.save_path)
        self.checkpoint_path.mkdir(parents=True, exist_ok=True)

    def save_checkpoint(self, step: int) -> str:
        path = self.checkpoint_path / f"step_{step}"
        path.mkdir(exist_ok=True)

        print(f"[GRPO] Saving checkpoint to {path}")
        self.model.save_pretrained(path)
        self.tokenizer.save_pretrained(path)

        # Save optimizer state
        torch.save(
            {
                "step": step,
                "optimizer_state_dict": self.optimizer.state_dict(),
            },
            path / "training_state.pt",
        )

        return str(path)

    def load_checkpoint(self, path: str):
        print(f"[GRPO] Loading checkpoint from {path}")
        self.model = AutoModelForCausalLM.from_pretrained(
            path,
            torch_dtype=torch.float16,
        ).to(self.device)
        self.model.gradient_checkpointing_enable()

        state_path = Path(path) / "training_state.pt"
        if state_path.exists():
            state = torch.load(state_path)
            self.current_step = state["step"]
            self.optimizer.load_state_dict(state["optimizer_state_dict"])

    def prepare_batch(self, batch_data: list) -> tuple:
        """Prepare batch from Atropos data."""
        all_input_ids = []
        all_labels = []
        all_advantages = []

        for item in batch_data:
            tokens = item["tokens"]
            masks = item["masks"]
            scores = item["scores"]

            # Normalize scores to get advantages
            scores_tensor = torch.tensor(scores, dtype=torch.float32)
            if len(scores) > 1:
                advantages = (scores_tensor - scores_tensor.mean()) / (scores_tensor.std() + 1e-8)
            else:
                advantages = scores_tensor

            for i, (toks, mask) in enumerate(zip(tokens, masks, strict=False)):
                # Pad to max length
                seq_len = min(len(toks), self.config.max_seq_len)
                input_ids = toks[:seq_len] + [self.tokenizer.pad_token_id] * (
                    self.config.max_seq_len - seq_len
                )
                labels = mask[:seq_len] + [-100] * (self.config.max_seq_len - seq_len)

                all_input_ids.append(input_ids)
                all_labels.append(labels)
                all_advantages.append(advantages[i].item())

        return (
            torch.tensor(all_input_ids, dtype=torch.long, device=self.device),
            torch.tensor(all_labels, dtype=torch.long, device=self.device),
            torch.tensor(all_advantages, dtype=torch.float32, device=self.device),
        )

    def train_step(self, batch_data: list) -> dict:
        """Execute one training step with actual gradient update."""
        self.model.train()
        self.optimizer.zero_grad()

        input_ids, labels, advantages = self.prepare_batch(batch_data)

        # Accumulate gradients over mini-batches
        total_loss = 0.0
        all_metrics = []

        batch_size = self.config.batch_size
        num_mini_batches = (len(input_ids) + batch_size - 1) // batch_size

        for i in range(num_mini_batches):
            start = i * batch_size
            end = min((i + 1) * batch_size, len(input_ids))

            mini_input_ids = input_ids[start:end]
            mini_labels = labels[start:end]
            mini_advantages = advantages[start:end]

            loss, metrics = compute_grpo_loss(
                self.model,
                mini_input_ids,
                mini_labels,
                mini_advantages,
            )

            # Scale loss for gradient accumulation
            scaled_loss = loss / num_mini_batches
            scaled_loss.backward()

            total_loss += loss.item()
            all_metrics.append(metrics)

        # Gradient clipping
        grad_norm = torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)

        # Optimizer step
        self.optimizer.step()

        # Aggregate metrics
        avg_metrics = {
            "loss": total_loss / num_mini_batches,
            "grad_norm": grad_norm.item(),
            "pos_log_prob": sum(m["pos_log_prob"] for m in all_metrics) / len(all_metrics),
            "neg_log_prob": sum(m["neg_log_prob"] for m in all_metrics) / len(all_metrics),
            "mean_advantage": sum(m["mean_advantage"] for m in all_metrics) / len(all_metrics),
        }

        return avg_metrics

    @torch.no_grad()
    def generate_completion(self, prompt: str, max_new_tokens: int = 128) -> str:
        """Generate completion using the training model directly."""
        self.model.eval()

        inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, max_length=512)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        outputs = self.model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.8,
            top_p=0.95,
            pad_token_id=self.tokenizer.pad_token_id,
        )

        # Decode only the new tokens
        new_tokens = outputs[0][inputs["input_ids"].shape[1] :]
        completion = self.tokenizer.decode(new_tokens, skip_special_tokens=True)
        return completion

    def collect_rollouts(self, prompts: list, group_size: int = 4) -> list:
        """Collect rollouts using the training model and score them."""
        all_data = []

        for prompt in prompts:
            completions = []
            tokens_list = []
            masks_list = []

            for _ in range(group_size):
                # Use training model for generation (no vLLM needed)
                completion = self.generate_completion(prompt, max_new_tokens=128)
                completions.append(completion)

                # Tokenize
                full_text = prompt + completion
                encoded = self.tokenizer(
                    full_text,
                    return_tensors="pt",
                    truncation=True,
                    max_length=self.config.max_seq_len,
                )
                prompt_encoded = self.tokenizer(prompt, return_tensors="pt")

                input_ids = encoded.input_ids[0].tolist()
                prompt_len = prompt_encoded.input_ids.shape[1]

                # Create mask: -100 for prompt, actual tokens for completion
                mask = [-100] * prompt_len + input_ids[prompt_len:]

                tokens_list.append(input_ids)
                masks_list.append(mask)

            # Score completions based on quality heuristics
            scores = []
            for c in completions:
                score = 0.0
                lower_c = c.lower()

                # Reward predictions with clear direction
                if any(w in lower_c for w in ["increase", "raised", "grow", "higher", "up"]):
                    score += 1.0
                if any(w in lower_c for w in ["decrease", "reduced", "decline", "lower", "down"]):
                    score += 0.8
                if any(w in lower_c for w in ["maintain", "stable", "unchanged", "steady"]):
                    score += 0.5

                # Reward specific numbers/percentages
                import re

                if re.search(r"\d+%|\d+\.\d+%", c):
                    score += 0.5

                # Reward reasonable length (not too short, not rambling)
                if 50 < len(c) < 300:
                    score += 0.3
                elif len(c) < 20:
                    score -= 0.5  # Too short

                # Penalize repetition
                words = c.split()
                if len(words) > 5:
                    unique_ratio = len(set(words)) / len(words)
                    if unique_ratio < 0.5:
                        score -= 0.5  # Too repetitive

                scores.append(score)

            all_data.append(
                {
                    "tokens": tokens_list,
                    "masks": masks_list,
                    "scores": scores,
                }
            )

        return all_data

    def train(self):
        """Main training loop with real gradient updates."""
        print(f"\n{'=' * 60}")
        print("[GRPO] REAL Distributed Training")
        print(f"{'=' * 60}")
        print(f"Model: {self.config.model_name}")
        print(f"Device: {self.device}")
        print(f"Learning rate: {self.config.learning_rate}")
        print(f"Training steps: {self.config.training_steps}")
        print(f"Group size: {self.config.group_size}")
        print(f"{'=' * 60}\n")

        # Register with Atropos
        self.atropos.register_trainer(self.config)
        print("[GRPO] Registered with Atropos")

        # Training prompts
        prompts = [
            "Analyze this financial data:\nQ3 Revenue: $45B (+12%)\nNet Income: $8B\nPredict earnings guidance direction.",
            "Given the following:\nRevenue down 5%\nCustomer churn up 3%\nPredict revenue forecast change.",
            "Market conditions:\nGDP growth 2.8%\nInflation 3.2%\nPredict dividend policy.",
            "Company update:\nNew product launch successful\nMarket share increased 3%\nPredict stock price movement.",
            "Economic indicators:\nUnemployment at 4.2%\nConsumer spending up 2%\nPredict sector performance.",
        ]

        loss_history = []

        for step in range(self.config.training_steps):
            print(f"\n--- Step {step + 1}/{self.config.training_steps} ---")

            # Collect rollouts using the training model
            rollouts = self.collect_rollouts(
                [prompts[step % len(prompts)]],
                group_size=self.config.group_size,
            )

            # Show score distribution
            scores = rollouts[0]["scores"]
            pos_scores = [s for s in scores if s > 0]
            neg_scores = [s for s in scores if s <= 0]
            print(f"[GRPO] Scores: {len(pos_scores)} positive, {len(neg_scores)} negative")
            print(f"[GRPO] Score range: [{min(scores):.2f}, {max(scores):.2f}]")

            # Submit to Atropos for coordination
            for data in rollouts:
                self.atropos.submit_scored_data(
                    data["tokens"],
                    data["masks"],
                    data["scores"],
                )

            # Train with real gradients
            metrics = self.train_step(rollouts)
            loss_history.append(metrics["loss"])

            # Show metrics
            print(
                f"[GRPO] Loss: {metrics['loss']:.4f} | Policy: {metrics.get('policy_loss', 0):.4f} | Entropy: {metrics.get('entropy', 0):.4f}"
            )
            print(
                f"[GRPO] Grad Norm: {metrics['grad_norm']:.2f} | Pos LogP: {metrics['pos_log_prob']:.4f} | Neg LogP: {metrics['neg_log_prob']:.4f}"
            )

            # Show running average
            if len(loss_history) >= 5:
                avg_loss = sum(loss_history[-5:]) / 5
                print(f"[GRPO] 5-step avg loss: {avg_loss:.4f}")

            self.current_step = step + 1

            # Save checkpoint periodically
            if (step + 1) % self.config.vllm_restart_interval == 0:
                self.save_checkpoint(step + 1)

        # Final save
        final_path = self.save_checkpoint(self.config.training_steps)

        # Summary
        print(f"\n{'=' * 60}")
        print("[GRPO] Training Complete")
        print(f"{'=' * 60}")
        print(f"Final loss: {loss_history[-1]:.4f}")
        print(f"Average loss: {sum(loss_history) / len(loss_history):.4f}")
        print(f"Model saved to: {final_path}")
        print(f"{'=' * 60}")


# ============================================================================
# Main
# ============================================================================


def main():
    parser = argparse.ArgumentParser(description="GRPO Training")
    parser.add_argument("--model", default="microsoft/phi-2", help="Model name or path")
    parser.add_argument("--steps", type=int, default=10, help="Training steps")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=2, help="Batch size")
    parser.add_argument("--save-path", default="./training_checkpoints", help="Checkpoint path")
    parser.add_argument("--atropos-url", default="http://localhost:8000", help="Atropos URL")
    parser.add_argument("--vllm-port", type=int, default=9001, help="vLLM port")
    args = parser.parse_args()

    config = TrainingConfig(
        model_name=args.model,
        training_steps=args.steps,
        learning_rate=args.lr,
        batch_size=args.batch_size,
        save_path=args.save_path,
        atropos_url=args.atropos_url,
        vllm_port=args.vllm_port,
    )

    trainer = GRPOTrainer(config)
    trainer.train()


if __name__ == "__main__":
    main()
