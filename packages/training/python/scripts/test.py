#!/usr/bin/env python3
"""
Jeju Model Testing Script

Test trained models (MLX adapters or full models) by:
1. Loading the model
2. Running inference on test prompts
3. Validating response quality
4. Interactive chat mode (optional)

Usage:
    # Test MLX adapter
    python scripts/test.py --adapter-path ./trained_models/adapters --base-model mlx-community/Qwen2.5-1.5B-Instruct-4bit
    
    # Test CUDA/CPU model
    python scripts/test.py --model-path ./trained_models/model
    
    # Interactive mode
    python scripts/test.py --adapter-path ./trained_models/adapters --interactive
    
    # Run validation
    python scripts/test.py --adapter-path ./trained_models/adapters --validate
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)


def detect_backend() -> Literal["mlx", "cuda", "cpu"]:
    """Auto-detect backend."""
    try:
        import mlx.core  # type: ignore
        logger.info("MLX backend detected")
        return "mlx"
    except ImportError:
        pass
    
    try:
        import torch
        if torch.cuda.is_available():
            logger.info(f"CUDA backend detected: {torch.cuda.get_device_name(0)}")
            return "cuda"
    except ImportError:
        pass
    
    logger.warning("No GPU backend, using CPU")
    return "cpu"


def get_test_prompts() -> list[str]:
    """Standard test prompts for trading agents."""
    return [
        """You are a trading agent in prediction markets.

Current State:
- Balance: $10,000
- P&L: $250
- Positions: 2 open

Market Update:
- BTC prediction market at 68% probability
- Recent news: Fed announces rate cut consideration

Analyze this market update and explain your trading decision.""",

        """You are evaluating a prediction market.

Market: "Will Bitcoin reach $100k by Q1 2025?"
Current Probability: 65% YES
Your Analysis: Technical indicators show bullish momentum, but macro uncertainty remains.

Should you buy YES or NO shares? Explain your reasoning.""",

        """You are managing a trading portfolio.

Current Holdings:
- 100 YES shares in "AI regulation passes" market
- 50 NO shares in "Ethereum upgrade succeeds" market

New Market Opens: "Stablecoin regulation announced"
Probability: 40% YES

How should you allocate capital? Explain your strategy.""",
    ]


def load_mlx_model(adapter_path: str, base_model: str):
    """Load MLX model with adapter."""
    from mlx_lm import load  # type: ignore
    
    logger.info("=" * 60)
    logger.info("LOADING MLX MODEL")
    logger.info("=" * 60)
    logger.info(f"Base model: {base_model}")
    logger.info(f"Adapter: {adapter_path}")
    
    model, tokenizer = load(base_model, adapter_path=adapter_path)
    logger.info("Model loaded successfully")
    
    return model, tokenizer, "mlx"


def load_pytorch_model(model_path: str):
    """Load PyTorch model (CUDA or CPU)."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    
    backend = "cuda" if torch.cuda.is_available() else "cpu"
    
    logger.info("=" * 60)
    logger.info(f"LOADING {'CUDA' if backend == 'cuda' else 'CPU'} MODEL")
    logger.info("=" * 60)
    logger.info(f"Model path: {model_path}")
    
    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=torch.float16 if backend == "cuda" else torch.float32,
        device_map="auto" if backend == "cuda" else None,
        trust_remote_code=True,
    )
    
    logger.info("Model loaded successfully")
    return model, tokenizer, backend


def generate_mlx(model, tokenizer, prompt: str, max_tokens: int = 300) -> str:
    """Generate response using MLX."""
    from mlx_lm import generate  # type: ignore
    
    messages = [{"role": "user", "content": prompt}]
    formatted = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    response = generate(model, tokenizer, prompt=formatted, max_tokens=max_tokens, verbose=False)
    return response


def generate_pytorch(model, tokenizer, prompt: str, backend: str, max_tokens: int = 300) -> str:
    """Generate response using PyTorch."""
    import torch
    
    messages = [{"role": "user", "content": prompt}]
    formatted = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    
    inputs = tokenizer(formatted, return_tensors="pt")
    if backend == "cuda":
        inputs = {k: v.cuda() for k, v in inputs.items()}
    
    outputs = model.generate(
        **inputs,
        max_new_tokens=max_tokens,
        temperature=0.7,
        do_sample=True,
        pad_token_id=tokenizer.eos_token_id,
    )
    
    response = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return response


def run_tests(model, tokenizer, backend: str, prompts: list[str]) -> dict:
    """Run inference on test prompts."""
    results = []
    
    for i, prompt in enumerate(prompts):
        logger.info(f"\nTest {i + 1}/{len(prompts)}")
        logger.info("-" * 60)
        logger.info(f"Prompt: {prompt[:100]}...")
        
        if backend == "mlx":
            response = generate_mlx(model, tokenizer, prompt)
        else:
            response = generate_pytorch(model, tokenizer, prompt, backend)
        
        logger.info(f"Response: {response[:200]}...")
        
        results.append({
            "prompt": prompt,
            "response": response,
            "length": len(response),
        })
    
    return {"backend": backend, "results": results}


def validate_responses(results: dict) -> dict:
    """Validate model responses."""
    validation = {
        "total_tests": len(results["results"]),
        "passed": 0,
        "failed": 0,
        "issues": [],
    }
    
    trading_keywords = ["trade", "buy", "sell", "market", "position", "risk", "profit", "analyze", "decision"]
    
    for i, result in enumerate(results["results"]):
        response = result["response"]
        
        if len(response) < 50:
            validation["issues"].append(f"Test {i + 1}: Response too short ({len(response)} chars)")
            validation["failed"] += 1
            continue
        
        has_keywords = any(keyword in response.lower() for keyword in trading_keywords)
        
        if not has_keywords:
            validation["issues"].append(f"Test {i + 1}: Response lacks trading-related content")
            validation["failed"] += 1
            continue
        
        validation["passed"] += 1
    
    return validation


def interactive_mode(model, tokenizer, backend: str):
    """Run interactive chat with the model."""
    logger.info("\n" + "=" * 60)
    logger.info("INTERACTIVE MODE")
    logger.info("Type 'quit' or 'exit' to stop")
    logger.info("=" * 60 + "\n")
    
    default_prompt = """Current Market State:
{
  "agentBalance": 10000,
  "heldPositions": [],
  "recentPrice": 105.50,
  "indicators": {"RSI": 75, "MACD": "bearish_crossover"}
}

Task: Analyze the market and make a trading decision."""
    
    while True:
        user_input = input("\nEnter prompt (or press Enter for default): ").strip()
        
        if user_input.lower() in ["quit", "exit"]:
            break
        
        prompt = user_input if user_input else default_prompt
        
        logger.info("Generating response...")
        
        if backend == "mlx":
            response = generate_mlx(model, tokenizer, prompt)
        else:
            response = generate_pytorch(model, tokenizer, prompt, backend)
        
        print("\n" + "=" * 40)
        print("RESPONSE:")
        print("=" * 40)
        print(response)
        print("=" * 40)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Jeju Model Testing",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    
    # Model paths (one required)
    model_group = parser.add_mutually_exclusive_group(required=True)
    model_group.add_argument("--adapter-path", help="Path to MLX adapter")
    model_group.add_argument("--model-path", help="Path to full model (CUDA/CPU)")
    
    parser.add_argument("--base-model", default="mlx-community/Qwen2.5-1.5B-Instruct-4bit", help="Base model for MLX adapter")
    
    # Testing options
    parser.add_argument("--validate", action="store_true", help="Run validation checks on responses")
    parser.add_argument("--interactive", action="store_true", help="Run interactive chat mode")
    parser.add_argument("--custom-prompts", nargs="+", help="Custom test prompts")
    parser.add_argument("--output", help="Save results to JSON file")
    
    args = parser.parse_args()
    
    # Determine backend and load model
    if args.adapter_path:
        backend = detect_backend()
        if backend != "mlx":
            logger.error("Adapter path specified but MLX backend not available")
            return 1
        
        if not os.path.exists(args.adapter_path):
            logger.error(f"Adapter path not found: {args.adapter_path}")
            return 1
        
        model, tokenizer, backend = load_mlx_model(args.adapter_path, args.base_model)
    else:
        if not os.path.exists(args.model_path):
            logger.error(f"Model path not found: {args.model_path}")
            return 1
        
        model, tokenizer, backend = load_pytorch_model(args.model_path)
    
    # Interactive mode
    if args.interactive:
        interactive_mode(model, tokenizer, backend)
        return 0
    
    # Get test prompts
    prompts = args.custom_prompts if args.custom_prompts else get_test_prompts()
    
    # Run tests
    results = run_tests(model, tokenizer, backend, prompts)
    
    # Validate if requested
    if args.validate:
        logger.info("\n" + "=" * 60)
        logger.info("VALIDATION RESULTS")
        logger.info("=" * 60)
        
        validation = validate_responses(results)
        
        logger.info(f"Total tests: {validation['total_tests']}")
        logger.info(f"Passed: {validation['passed']}")
        logger.info(f"Failed: {validation['failed']}")
        
        if validation['issues']:
            logger.warning("Issues found:")
            for issue in validation['issues']:
                logger.warning(f"  - {issue}")
        
        results['validation'] = validation
    
    # Save results
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"\nResults saved to: {args.output}")
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("TESTING COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Backend: {results['backend']}")
    logger.info(f"Tests run: {len(results['results'])}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
