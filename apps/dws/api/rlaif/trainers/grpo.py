"""
GRPO (Group Relative Policy Optimization) Trainer for Jeju DWS

This trainer implements GRPO for training language models using RLAIF data.
Generalized from Jeju's atropos_trainer.py to work with any environment.

Key features:
- Pulls training data from Jeju Storage (CID-based)
- Implements GRPO training loop with transformers
- Saves checkpoints to Jeju Storage
- Reports metrics for on-chain recording
"""

import argparse
import json
import logging
import math
import os

import numpy as np
import requests
import torch
import torch.nn.functional as F
from torch.optim import AdamW
from transformers import AutoModelForCausalLM, AutoTokenizer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


class GRPOTrainer:
    """
    GRPO Trainer for Jeju DWS

    Implements Group Relative Policy Optimization using:
    - Trajectories from Jeju Storage
    - Scores from RULER judging
    - On-chain coordination
    """

    def __init__(
        self,
        model_name: str,
        storage_url: str,
        learning_rate: float = 1e-5,
        batch_size: int = 4,
        gradient_accumulation_steps: int = 8,
        max_seq_len: int = 4096,
        max_grad_norm: float = 1.0,
        kl_coefficient: float = 0.1,
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
    ):
        self.model_name = model_name
        self.storage_url = storage_url
        self.learning_rate = learning_rate
        self.batch_size = batch_size
        self.gradient_accumulation_steps = gradient_accumulation_steps
        self.max_seq_len = max_seq_len
        self.max_grad_norm = max_grad_norm
        self.kl_coefficient = kl_coefficient
        self.device = device

        self.model = None
        self.ref_model = None
        self.tokenizer = None
        self.optimizer = None

    def setup(self, reference_model_cid: str | None = None):
        """Initialize models and optimizer"""
        logger.info(f"Loading model: {self.model_name}")

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name, trust_remote_code=True)

        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name, torch_dtype=torch.bfloat16, trust_remote_code=True
        )
        self.model.to(self.device)
        self.model.gradient_checkpointing_enable()
        self.model.train()

        # Load or clone reference model
        if reference_model_cid:
            ref_path = self._download_model(reference_model_cid)
            self.ref_model = AutoModelForCausalLM.from_pretrained(
                ref_path, torch_dtype=torch.bfloat16, trust_remote_code=True
            )
        else:
            # Clone current model as reference
            self.ref_model = AutoModelForCausalLM.from_pretrained(
                self.model_name, torch_dtype=torch.bfloat16, trust_remote_code=True
            )

        self.ref_model.to(self.device)
        self.ref_model.eval()
        for param in self.ref_model.parameters():
            param.requires_grad = False

        self.optimizer = AdamW(self.model.parameters(), lr=self.learning_rate)

        logger.info(f"Model loaded on {self.device}")

    def load_training_data(self, trajectory_manifest_cid: str, rewards_cid: str) -> list[dict]:
        """Load trajectories and rewards from Jeju Storage"""
        assert self.tokenizer is not None, "Tokenizer not initialized - call setup() first"
        logger.info(f"Loading trajectories from {trajectory_manifest_cid}")

        # Load manifest
        manifest = self._fetch_from_storage(trajectory_manifest_cid)

        # Load rewards
        rewards_data = self._fetch_from_storage(rewards_cid)
        scores_by_id = {s["trajectoryId"]: s for s in rewards_data.get("scores", [])}

        # Load and match trajectories
        training_data = []
        for traj_cid in manifest.get("trajectoryCIDs", []):
            trajectory = self._fetch_from_storage(traj_cid)
            traj_id = trajectory.get("id")

            if traj_id not in scores_by_id:
                continue

            score = scores_by_id[traj_id]["score"]

            # Convert trajectory to training format
            messages = self._trajectory_to_messages(trajectory)
            tokens = self.tokenizer.apply_chat_template(
                messages, return_tensors="pt", truncation=True, max_length=self.max_seq_len
            )[0]

            # Create mask (train on assistant tokens only)
            mask = self._create_training_mask(messages, tokens)

            training_data.append(
                {
                    "trajectory_id": traj_id,
                    "tokens": tokens.numpy(),
                    "mask": mask.numpy(),
                    "score": score,
                }
            )

        logger.info(f"Loaded {len(training_data)} training examples")
        return training_data

    def _trajectory_to_messages(self, trajectory: dict) -> list[dict]:
        """Convert trajectory to chat messages"""
        messages = []

        # System message
        messages.append(
            {
                "role": "system",
                "content": f"Environment: {trajectory.get('environmentId', 'unknown')}",
            }
        )

        for step in trajectory.get("steps", []):
            # User message
            observation = step.get("observation", {})
            messages.append(
                {"role": "user", "content": f"Observation: {json.dumps(observation)[:500]}"}
            )

            # Assistant message
            action = step.get("action", {})
            reasoning = action.get("reasoning", "")
            action_content = ""

            if reasoning:
                action_content += f"<thinking>\n{reasoning}\n</thinking>\n\n"

            action_content += f"Action: {action.get('type', 'unknown')}"
            if action.get("parameters"):
                action_content += f"\nParameters: {json.dumps(action['parameters'])}"

            messages.append({"role": "assistant", "content": action_content})

        return messages

    def _create_training_mask(self, messages: list[dict], tokens: torch.Tensor) -> torch.Tensor:
        """Create mask for training (1 for assistant tokens, -100 for others)"""
        assert self.tokenizer is not None, "Tokenizer not initialized"
        mask = torch.full_like(tokens, -100)

        # Simple approach: find assistant response regions
        # In practice, use tokenizer's chat template metadata
        text = self.tokenizer.apply_chat_template(messages, tokenize=False)

        # Find assistant sections and mark them
        assistant_start = "<|im_start|>assistant"
        assistant_end = "<|im_end|>"

        start_idx = 0
        while True:
            start = text.find(assistant_start, start_idx)
            if start == -1:
                break

            end = text.find(assistant_end, start)
            if end == -1:
                end = len(text)

            # Get token positions for this range
            prefix = text[: start + len(assistant_start) + 1]
            content = text[start + len(assistant_start) + 1 : end]

            prefix_tokens = len(self.tokenizer.encode(prefix))
            content_tokens = len(self.tokenizer.encode(content))

            # Mark these tokens as trainable
            for i in range(prefix_tokens, min(prefix_tokens + content_tokens, len(mask))):
                mask[i] = tokens[i]

            start_idx = end

        return mask

    def train_step(self, batch_data: list[dict]) -> dict:
        """Execute one GRPO training step"""
        assert self.model is not None
        assert self.ref_model is not None

        total_loss = 0.0
        total_kl = 0.0

        # Prepare batch
        tokens_list = []
        masks_list = []
        scores_list = []

        for item in batch_data:
            tokens_list.append(item["tokens"])
            masks_list.append(item["mask"])
            scores_list.append(item["score"])

        # Normalize scores (GRPO: relative to group mean)
        scores = np.array(scores_list)
        if len(scores) > 1:
            scores = scores - scores.mean()
            std = scores.std()
            if std > 1e-8:
                scores = scores / std

        # Pad sequences
        max_len = max(len(t) for t in tokens_list)
        max_len = ((max_len - 1) // 64 + 1) * 64  # Pad to multiple of 64

        for i in range(len(tokens_list)):
            pad_len = max_len - len(tokens_list[i])
            tokens_list[i] = np.concatenate([tokens_list[i], np.zeros(pad_len, dtype=np.int32)])
            masks_list[i] = np.concatenate([masks_list[i], np.full(pad_len, -100, dtype=np.int32)])

        # Convert to tensors
        tokens = torch.tensor(np.stack(tokens_list)[:, :-1]).to(self.device)
        labels = torch.tensor(np.stack(masks_list)[:, 1:]).to(self.device)
        advantages = torch.tensor(scores, dtype=torch.float32).view(-1, 1).to(self.device)

        # Forward pass - policy model
        outputs = self.model(tokens)
        logits = outputs.logits

        # Forward pass - reference model
        with torch.no_grad():
            ref_outputs = self.ref_model(tokens)
            ref_logits = ref_outputs.logits

        # Calculate log probabilities
        logp = -F.cross_entropy(
            logits.view(-1, logits.size(-1)),
            labels.view(-1),
            reduction="none",
            ignore_index=-100,
        ).view(labels.shape)

        ref_logp = -F.cross_entropy(
            ref_logits.view(-1, ref_logits.size(-1)),
            labels.view(-1),
            reduction="none",
            ignore_index=-100,
        ).view(labels.shape)

        # Mask for valid tokens
        mask = (labels != -100).float()
        mask_sum = mask.sum(dim=-1).clamp_min(1e-8)

        # KL divergence
        kl = ((logp - ref_logp) * mask).sum(dim=-1) / mask_sum
        total_kl = kl.mean().item()

        # GRPO loss
        grpo_term = torch.exp(logp - logp.detach())
        grpo_loss = (((-grpo_term * mask).sum(-1) / mask_sum) * advantages.squeeze(-1)).mean()

        # KL penalty
        kl_loss = self.kl_coefficient * kl.mean()

        # Total loss
        loss = (grpo_loss + kl_loss) / self.gradient_accumulation_steps
        loss.backward()

        total_loss = loss.item() * self.gradient_accumulation_steps

        return {
            "loss": total_loss,
            "kl_divergence": total_kl,
        }

    def train(
        self,
        trajectory_manifest_cid: str,
        rewards_cid: str,
        num_epochs: int = 1,
        output_dir: str = "./output",
    ) -> dict:
        """Full training loop"""
        os.makedirs(output_dir, exist_ok=True)

        # Load data
        training_data = self.load_training_data(trajectory_manifest_cid, rewards_cid)

        if not training_data:
            raise ValueError("No training data loaded")

        all_metrics = []

        for epoch in range(num_epochs):
            logger.info(f"Epoch {epoch + 1}/{num_epochs}")

            # Shuffle data
            np.random.shuffle(training_data)

            # Process in batches
            num_batches = math.ceil(len(training_data) / self.batch_size)

            for batch_idx in range(num_batches):
                start = batch_idx * self.batch_size
                end = min(start + self.batch_size, len(training_data))
                batch = training_data[start:end]

                metrics = self.train_step(batch)

                # Accumulate gradients
                if (batch_idx + 1) % self.gradient_accumulation_steps == 0:
                    assert self.model is not None, "Model not initialized"
                    assert self.optimizer is not None, "Optimizer not initialized"
                    grad_norm = torch.nn.utils.clip_grad_norm_(
                        self.model.parameters(), max_norm=self.max_grad_norm
                    )
                    self.optimizer.step()
                    self.optimizer.zero_grad()

                    metrics["grad_norm"] = grad_norm.item()
                    all_metrics.append(metrics)

                    logger.info(
                        f"  Batch {batch_idx + 1}/{num_batches}: "
                        f"loss={metrics['loss']:.4f}, kl={metrics['kl_divergence']:.4f}"
                    )

        # Save checkpoint
        assert self.model is not None, "Model not initialized"
        assert self.tokenizer is not None, "Tokenizer not initialized"
        checkpoint_path = os.path.join(output_dir, "checkpoint")
        self.model.save_pretrained(checkpoint_path)
        self.tokenizer.save_pretrained(checkpoint_path)

        logger.info(f"Saved checkpoint to {checkpoint_path}")

        # Calculate final metrics
        final_metrics = {
            "epochs": num_epochs,
            "total_steps": len(all_metrics),
            "final_loss": all_metrics[-1]["loss"] if all_metrics else 0,
            "average_kl": np.mean([m["kl_divergence"] for m in all_metrics]) if all_metrics else 0,
            "average_grad_norm": np.mean([m.get("grad_norm", 0) for m in all_metrics])
            if all_metrics
            else 0,
        }

        # Save metrics
        with open(os.path.join(output_dir, "metrics.json"), "w") as f:
            json.dump(final_metrics, f, indent=2)

        return final_metrics

    def upload_checkpoint(self, output_dir: str) -> str:
        """Upload checkpoint to Jeju Storage and return CID"""
        # Create tarball
        import io
        import tarfile

        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(output_dir, arcname="checkpoint")

        tar_buffer.seek(0)

        # Upload to storage
        response = requests.post(
            f"{self.storage_url}/upload",
            files={"file": ("checkpoint.tar.gz", tar_buffer, "application/gzip")},
        )

        if not response.ok:
            raise RuntimeError(f"Failed to upload checkpoint: {response.status_code}")

        result = response.json()
        return result["cid"]

    def _fetch_from_storage(self, cid: str) -> dict:
        """Fetch JSON data from Jeju Storage"""
        response = requests.get(f"{self.storage_url}/get/{cid}")
        if not response.ok:
            raise RuntimeError(f"Failed to fetch {cid}: {response.status_code}")
        return response.json()

    def _download_model(self, cid: str) -> str:
        """Download model from Jeju Storage"""
        import tarfile
        import tempfile

        response = requests.get(f"{self.storage_url}/get/{cid}", stream=True)
        if not response.ok:
            raise RuntimeError(f"Failed to download model {cid}: {response.status_code}")

        # Extract to temp directory
        temp_dir = tempfile.mkdtemp()
        with tarfile.open(fileobj=response.raw, mode="r:gz") as tar:
            tar.extractall(temp_dir)

        return os.path.join(temp_dir, "checkpoint")


def main():
    parser = argparse.ArgumentParser(description="GRPO Trainer for Jeju DWS")
    parser.add_argument("--model", required=True, help="Base model name or CID")
    parser.add_argument("--trajectory-manifest", required=True, help="Trajectory manifest CID")
    parser.add_argument("--rewards", required=True, help="Rewards CID")
    parser.add_argument("--reference-model", help="Reference model CID (optional)")
    parser.add_argument("--storage-url", default="http://localhost:4010", help="Jeju Storage URL")
    parser.add_argument("--output", default="./output", help="Output directory")
    parser.add_argument("--epochs", type=int, default=1, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--kl-coeff", type=float, default=0.1, help="KL coefficient")
    parser.add_argument("--upload", action="store_true", help="Upload checkpoint to storage")

    args = parser.parse_args()

    trainer = GRPOTrainer(
        model_name=args.model,
        storage_url=args.storage_url,
        learning_rate=args.lr,
        batch_size=args.batch_size,
        kl_coefficient=args.kl_coeff,
    )

    trainer.setup(reference_model_cid=args.reference_model)

    metrics = trainer.train(
        trajectory_manifest_cid=args.trajectory_manifest,
        rewards_cid=args.rewards,
        num_epochs=args.epochs,
        output_dir=args.output,
    )

    print(json.dumps(metrics, indent=2))

    if args.upload:
        cid = trainer.upload_checkpoint(args.output)
        print(f"Uploaded checkpoint: {cid}")

        # Write CID to file for container output
        with open(os.path.join(args.output, "output_cid.txt"), "w") as f:
            f.write(cid)


if __name__ == "__main__":
    main()
