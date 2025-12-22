"""
Rubric Loader - Single Source of Truth

Loads archetype rubrics from the canonical JSON config file.
This eliminates duplication between TypeScript and Python.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# Find the config directory relative to this file
_CURRENT_DIR = Path(__file__).parent
_CONFIG_DIR = _CURRENT_DIR.parent.parent.parent / "config"
_RUBRICS_FILE = _CONFIG_DIR / "rubrics.json"


class RubricFileSchema(BaseModel):
    """Schema for validating rubrics.json configuration file."""
    
    model_config = {"extra": "ignore"}
    
    rubrics: Dict[str, str] = Field(default_factory=dict, description="Archetype rubrics")
    priorityMetrics: Dict[str, List[str]] = Field(
        default_factory=dict,
        alias="priorityMetrics",
        description="Priority metrics per archetype"
    )
    defaults: Dict[str, str | List[str]] = Field(
        default_factory=dict,
        description="Default rubric and metrics"
    )
    availableArchetypes: List[str] = Field(
        default_factory=list,
        alias="availableArchetypes",
        description="List of available archetype names"
    )

    @field_validator("rubrics", mode="before")
    @classmethod
    def ensure_rubrics_dict(cls, v):
        return v if isinstance(v, dict) else {}

    @field_validator("priorityMetrics", mode="before")
    @classmethod
    def ensure_priority_metrics_dict(cls, v):
        return v if isinstance(v, dict) else {}


class RubricConfig:
    """Singleton for rubric configuration loaded from JSON."""
    
    _instance: Optional['RubricConfig'] = None
    _rubrics: Dict[str, str]
    _priority_metrics: Dict[str, List[str]]
    _default_rubric: str
    _default_metrics: List[str]
    _available_archetypes: List[str]
    
    def __new__(cls) -> 'RubricConfig':
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._load_config()
        return cls._instance
    
    def _load_config(self) -> None:
        """Load rubrics from JSON config file with Pydantic validation."""
        if not _RUBRICS_FILE.exists():
            # Fallback to defaults if file not found
            self._rubrics = {}
            self._priority_metrics = {}
            self._default_rubric = _get_fallback_default_rubric()
            self._default_metrics = [
                "trading.totalPnL",
                "trading.winRate",
                "behavior.actionSuccessRate",
                "behavior.episodeLength",
            ]
            self._available_archetypes = []
            return
        
        with open(_RUBRICS_FILE, 'r', encoding='utf-8') as f:
            raw_config = json.load(f)
        
        # Validate with Pydantic
        config = RubricFileSchema.model_validate(raw_config)
        
        self._rubrics = config.rubrics
        self._priority_metrics = config.priorityMetrics
        defaults = config.defaults
        self._default_rubric = str(defaults.get("rubric", _get_fallback_default_rubric()))
        default_metrics = defaults.get("priorityMetrics", [])
        self._default_metrics = default_metrics if isinstance(default_metrics, list) else []
        self._available_archetypes = config.availableArchetypes if config.availableArchetypes else list(self._rubrics.keys())
    
    def get_rubric(self, archetype: str) -> str:
        """Get rubric for an archetype."""
        normalized = archetype.lower().strip().replace("_", "-")
        return self._rubrics.get(normalized, self._default_rubric)
    
    def get_priority_metrics(self, archetype: str) -> List[str]:
        """Get priority metrics for an archetype."""
        normalized = archetype.lower().strip().replace("_", "-")
        return self._priority_metrics.get(normalized, self._default_metrics)
    
    def get_available_archetypes(self) -> List[str]:
        """Get list of all available archetypes."""
        return self._available_archetypes.copy()
    
    def has_custom_rubric(self, archetype: str) -> bool:
        """Check if archetype has a custom rubric."""
        normalized = archetype.lower().strip().replace("_", "-")
        return normalized in self._rubrics
    
    def reload(self) -> None:
        """Reload configuration from file."""
        self._load_config()


def _get_fallback_default_rubric() -> str:
    """Fallback rubric if config file not found."""
    return """
## General Agent Evaluation

You are evaluating an AI agent's performance in a prediction market simulation.

### Scoring Criteria (0.0 to 1.0)
- **Profitability**: Higher P&L should receive higher scores
- **Risk Management**: Balanced positions and avoiding excessive losses
- **Efficiency**: Achieving goals with fewer actions is better
- **Decision Quality**: Good reasoning and analysis before actions

### Scoring Guidelines
- 0.8-1.0: Excellent performance, consistent profits, good risk management
- 0.6-0.8: Good performance, positive P&L, reasonable decisions
- 0.4-0.6: Average performance, mixed results
- 0.2-0.4: Below average, some losses, questionable decisions
- 0.0-0.2: Poor performance, significant losses, poor decision making

Compare trajectories RELATIVE to each other within this group.
If one trajectory is significantly better, reflect that in score differences.
"""


# Module-level convenience functions
_config = RubricConfig()


def get_rubric(archetype: str) -> str:
    """Get the rubric for an archetype."""
    return _config.get_rubric(archetype)


def get_priority_metrics(archetype: str) -> List[str]:
    """Get priority metrics for an archetype."""
    return _config.get_priority_metrics(archetype)


def get_available_archetypes() -> List[str]:
    """Get list of all available archetypes."""
    return _config.get_available_archetypes()


def has_custom_rubric(archetype: str) -> bool:
    """Check if archetype has a custom rubric."""
    return _config.has_custom_rubric(archetype)


def reload_rubrics() -> None:
    """Reload rubrics from file."""
    _config.reload()


# For backwards compatibility, expose DEFAULT_RUBRIC
DEFAULT_RUBRIC = _get_fallback_default_rubric()

