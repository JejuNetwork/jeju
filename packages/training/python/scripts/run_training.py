#!/usr/bin/env python3
"""
Babylon RL Training - Full Pipeline Runner

This script orchestrates the complete RLAIF training pipeline:
1. Starts the Atropos API server
2. Starts the Babylon RLAIF environment
3. Starts the GRPO trainer

Usage:
    python scripts/run_training.py --steps 100 --model Qwen/Qwen2.5-3B-Instruct
    
Or run components separately:
    Terminal 1: run-api
    Terminal 2: python -m src.training.babylon_env serve --slurm false
    Terminal 3: python -m src.training.atropos_trainer --steps 100
"""

import argparse
import asyncio
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

# Load environment
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)


class TrainingOrchestrator:
    """Orchestrates the complete training pipeline"""
    
    def __init__(
        self,
        model_name: str = "Qwen/Qwen2.5-3B-Instruct",
        training_steps: int = 100,
        batch_size: int = 4,
        learning_rate: float = 1e-5,
        api_port: int = 8000,
        vllm_port: int = 9001,
        save_path: str = "./trained_models",
        use_wandb: bool = True,
        wandb_project: str = "babylon-rl",
    ):
        self.model_name = model_name
        self.training_steps = training_steps
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        self.api_port = api_port
        self.vllm_port = vllm_port
        self.save_path = save_path
        self.use_wandb = use_wandb
        self.wandb_project = wandb_project
        
        self.api_process: Optional[subprocess.Popen] = None
        self.env_process: Optional[subprocess.Popen] = None
        self.trainer_process: Optional[subprocess.Popen] = None
        
        # Register cleanup
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info("Received shutdown signal, cleaning up...")
        self.cleanup()
        sys.exit(0)
        
    def cleanup(self):
        """Clean up all subprocesses"""
        for name, proc in [
            ("trainer", self.trainer_process),
            ("environment", self.env_process),
            ("API server", self.api_process),
        ]:
            if proc:
                logger.info(f"Stopping {name}...")
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                    
    def check_database(self) -> bool:
        """Verify database connection"""
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            logger.error("DATABASE_URL not set!")
            return False
            
        logger.info("Database URL configured")
        return True
        
    def start_api_server(self) -> bool:
        """Start Atropos API server"""
        logger.info(f"Starting Atropos API server on port {self.api_port}...")
        
        try:
            # Use run-api command from atroposlib
            self.api_process = subprocess.Popen(
                ["run-api", "--port", str(self.api_port)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            
            # Wait for server to start
            time.sleep(3)
            
            if self.api_process.poll() is not None:
                logger.error("API server failed to start")
                return False
                
            logger.info(f"API server started (PID: {self.api_process.pid})")
            return True
            
        except FileNotFoundError:
            logger.error("run-api command not found. Install with: pip install atroposlib")
            return False
        except Exception as e:
            logger.error(f"Failed to start API server: {e}")
            return False
            
    def start_environment(self) -> bool:
        """Start Babylon RLAIF environment"""
        logger.info("Starting Babylon RLAIF environment...")
        
        env_cmd = [
            sys.executable, "-m", "src.training.babylon_env", "serve",
            "--slurm", "false",
            "--env--tokenizer_name", self.model_name,
            "--env--rollout_server_url", f"http://localhost:{self.api_port}",
            "--openai--model_name", self.model_name,
            "--openai--base_url", f"http://localhost:{self.vllm_port}/v1",
        ]
        
        if not self.use_wandb:
            env_cmd.extend(["--env--use_wandb", "false"])
            
        try:
            self.env_process = subprocess.Popen(
                env_cmd,
                cwd=str(Path(__file__).parent.parent),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            
            # Wait for environment to initialize
            time.sleep(5)
            
            if self.env_process.poll() is not None:
                logger.error("Environment failed to start")
                return False
                
            logger.info(f"Environment started (PID: {self.env_process.pid})")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start environment: {e}")
            return False
            
    def start_trainer(self) -> bool:
        """Start GRPO trainer"""
        logger.info("Starting GRPO trainer...")
        
        trainer_cmd = [
            sys.executable, "-m", "src.training.atropos_trainer",
            "--model", self.model_name,
            "--steps", str(self.training_steps),
            "--batch-size", str(self.batch_size),
            "--lr", str(self.learning_rate),
            "--api-url", f"http://localhost:{self.api_port}",
            "--vllm-port", str(self.vllm_port),
            "--save-path", self.save_path,
            "--wandb-project", self.wandb_project,
        ]
        
        if not self.use_wandb:
            trainer_cmd.append("--no-wandb")
            
        try:
            self.trainer_process = subprocess.Popen(
                trainer_cmd,
                cwd=str(Path(__file__).parent.parent),
            )
            
            logger.info(f"Trainer started (PID: {self.trainer_process.pid})")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start trainer: {e}")
            return False
            
    def run(self) -> int:
        """Run the complete training pipeline"""
        logger.info("=" * 60)
        logger.info("BABYLON RL TRAINING PIPELINE")
        logger.info("=" * 60)
        logger.info(f"Model: {self.model_name}")
        logger.info(f"Steps: {self.training_steps}")
        logger.info(f"Batch size: {self.batch_size}")
        logger.info(f"Learning rate: {self.learning_rate}")
        logger.info(f"Save path: {self.save_path}")
        logger.info("=" * 60)
        
        # Check prerequisites
        if not self.check_database():
            return 1
            
        try:
            # Start components
            if not self.start_api_server():
                self.cleanup()
                return 1
                
            if not self.start_environment():
                self.cleanup()
                return 1
                
            if not self.start_trainer():
                self.cleanup()
                return 1
                
            # Wait for trainer to complete
            logger.info("Training started. Waiting for completion...")
            return_code = self.trainer_process.wait()
            
            if return_code == 0:
                logger.info("=" * 60)
                logger.info("TRAINING COMPLETED SUCCESSFULLY")
                logger.info(f"Model saved to: {self.save_path}")
                logger.info("=" * 60)
            else:
                logger.error(f"Training failed with return code: {return_code}")
                
            return return_code
            
        finally:
            self.cleanup()


def main():
    parser = argparse.ArgumentParser(
        description="Babylon RL Training Pipeline",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    
    parser.add_argument(
        "--model",
        default="Qwen/Qwen2.5-3B-Instruct",
        help="Model to train"
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=100,
        help="Number of training steps"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="Batch size"
    )
    parser.add_argument(
        "--lr",
        type=float,
        default=1e-5,
        help="Learning rate"
    )
    parser.add_argument(
        "--api-port",
        type=int,
        default=8000,
        help="Atropos API server port"
    )
    parser.add_argument(
        "--vllm-port",
        type=int,
        default=9001,
        help="vLLM inference server port"
    )
    parser.add_argument(
        "--save-path",
        default="./trained_models",
        help="Directory to save checkpoints"
    )
    parser.add_argument(
        "--wandb-project",
        default="babylon-rl",
        help="W&B project name"
    )
    parser.add_argument(
        "--no-wandb",
        action="store_true",
        help="Disable W&B logging"
    )
    
    args = parser.parse_args()
    
    orchestrator = TrainingOrchestrator(
        model_name=args.model,
        training_steps=args.steps,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        api_port=args.api_port,
        vllm_port=args.vllm_port,
        save_path=args.save_path,
        use_wandb=not args.no_wandb,
        wandb_project=args.wandb_project,
    )
    
    sys.exit(orchestrator.run())


if __name__ == "__main__":
    main()

