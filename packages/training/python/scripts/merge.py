#!/usr/bin/env python3
"""
Jeju LoRA Adapter Merging Script

Merges a trained LoRA adapter back into the base model for faster inference.
The merged model can be served directly without loading adapters at runtime.

Usage:
    # Merge adapter into base model
    python scripts/merge.py --adapter ./trained_models/adapter --output ./trained_models/merged

    # Specify base model explicitly
    python scripts/merge.py --adapter ./trained_models/adapter --base-model Qwen/Qwen2.5-0.5B-Instruct --output ./merged
"""

import argparse
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def merge_pytorch_adapter(adapter_dir: str, output_dir: str, base_model: str | None = None) -> int:
    """Merge PyTorch/PEFT adapter into base model."""
    import torch
    from peft import AutoPeftModelForCausalLM
    from transformers import AutoTokenizer

    logger.info("=" * 60)
    logger.info("MERGING PYTORCH/PEFT ADAPTER")
    logger.info("=" * 60)
    logger.info(f"Adapter: {adapter_dir}")
    logger.info(f"Output: {output_dir}")

    # Load adapter
    logger.info("Loading adapter...")
    model = AutoPeftModelForCausalLM.from_pretrained(
        adapter_dir, device_map="auto", torch_dtype=torch.float16
    )

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(adapter_dir)

    # Merge
    logger.info("Merging weights...")
    model = model.merge_and_unload()

    # Save
    logger.info(f"Saving merged model to {output_dir}...")
    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    logger.info("Merge complete")
    return 0


def merge_mlx_adapter(adapter_dir: str, base_model: str, output_dir: str) -> int:
    """Merge MLX LoRA adapter into base model."""
    import subprocess

    logger.info("=" * 60)
    logger.info("MERGING MLX LORA ADAPTER")
    logger.info("=" * 60)
    logger.info(f"Base model: {base_model}")
    logger.info(f"Adapter: {adapter_dir}")
    logger.info(f"Output: {output_dir}")

    # Use mlx_lm fuse command
    cmd = [
        sys.executable,
        "-m",
        "mlx_lm",
        "fuse",
        "--model",
        base_model,
        "--adapter-path",
        adapter_dir,
        "--save-path",
        output_dir,
    ]

    logger.info(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd)

    if result.returncode == 0:
        logger.info("Merge complete")
    else:
        logger.error("Merge failed")

    return result.returncode


def detect_adapter_type(adapter_dir: str) -> str:
    """Detect if adapter is MLX or PyTorch/PEFT."""
    adapter_path = Path(adapter_dir)

    # MLX adapters have these files
    mlx_files = ["adapter_config.json", "adapters.safetensors"]
    # PEFT adapters have this
    peft_files = ["adapter_model.safetensors", "adapter_model.bin"]

    has_mlx = all((adapter_path / f).exists() for f in mlx_files)
    has_peft = any((adapter_path / f).exists() for f in peft_files)

    if has_mlx and not has_peft:
        return "mlx"
    elif has_peft:
        return "peft"
    else:
        # Check for config to determine
        config_path = adapter_path / "adapter_config.json"
        if config_path.exists():
            import json

            with open(config_path) as f:
                config = json.load(f)
            if "architectures" in config:
                return "peft"
            return "mlx"
        return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Merge LoRA adapter into base model",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument("--adapter", required=True, help="Path to adapter directory")
    parser.add_argument("--output", required=True, help="Output directory for merged model")
    parser.add_argument("--base-model", help="Base model (required for MLX, optional for PEFT)")
    parser.add_argument(
        "--type", choices=["mlx", "peft", "auto"], default="auto", help="Adapter type"
    )

    args = parser.parse_args()

    if not os.path.exists(args.adapter):
        logger.error(f"Adapter directory not found: {args.adapter}")
        return 1

    # Detect or use specified type
    adapter_type = args.type
    if adapter_type == "auto":
        adapter_type = detect_adapter_type(args.adapter)
        logger.info(f"Detected adapter type: {adapter_type}")

    if adapter_type == "unknown":
        logger.error("Could not detect adapter type. Specify --type mlx or --type peft")
        return 1

    if adapter_type == "mlx":
        if not args.base_model:
            logger.error("--base-model required for MLX adapters")
            return 1
        return merge_mlx_adapter(args.adapter, args.base_model, args.output)
    else:
        return merge_pytorch_adapter(args.adapter, args.output, args.base_model)


if __name__ == "__main__":
    sys.exit(main())
