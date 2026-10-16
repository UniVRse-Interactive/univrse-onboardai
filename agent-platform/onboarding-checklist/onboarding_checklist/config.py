"""Configuration of the onboarding checklist agent, read from the environment.

A missing or unsafe value stops the agent with one message naming the
variables (there are no secrets here).

- Gemini on Vertex AI: GOOGLE_GENAI_USE_VERTEXAI must be TRUE (Application
  Default Credentials, never an API key). The project and location come from
  CHECKLIST_GEMINI_PROJECT and CHECKLIST_GEMINI_LOCATION when they are set,
  else from GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (default global).
  Vertex AI Agent Engine reserves the GOOGLE_CLOUD_* variables and sets them to
  the engine's own project and region, while the model is served at global, so
  the deployed agent gets the CHECKLIST_GEMINI_* ones.
- CHECKLIST_AGENT_MODEL: the Gemini model, default gemini-3.8-flash.
- CHECKLIST_AGENT_THINKING: "low" (thinkingLevel LOW) or "default" (the
  model's own thinking); see DEFAULT_THINKING. Gemini 2.5 models reject
  thinkingLevel, so use "default" with them.
- Firestore: FIRESTORE_PROJECT_ID (default: Gemini's project) and
  FIRESTORE_DATABASE_ID (default "(default)"). FIRESTORE_EMULATOR_HOST, when
  set, is used by the Firestore client itself (local only).
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_MODEL = "gemini-3.8-flash"
THINKING_MODES = ("low", "default")
DEFAULT_THINKING = "default"
DEFAULT_LOCATION = "global"
DEFAULT_DATABASE = "(default)"
# Marking a step must be repeatable: the same message gives the same proposal.
TEMPERATURE = 0.0
OVERRIDES = {
    "GOOGLE_CLOUD_PROJECT": "CHECKLIST_GEMINI_PROJECT",
    "GOOGLE_CLOUD_LOCATION": "CHECKLIST_GEMINI_LOCATION",
}
_MODEL = re.compile(r"^[a-z0-9][a-z0-9.-]{0,127}$")
_DATABASE = re.compile(r"^(\(default\)|[a-z][a-z0-9-]{3,62})$")


class ChecklistConfigError(RuntimeError):
    """The agent cannot start with the current environment."""


@dataclass(frozen=True)
class ChecklistConfig:
    model: str
    # Gemini's project and location (see the module docstring).
    project: str
    location: str
    firestore_project: str
    firestore_database: str
    temperature: float = TEMPERATURE
    thinking: str = DEFAULT_THINKING


def load_config(env: Mapping[str, str] | None = None) -> ChecklistConfig:
    """Reads and checks the settings; raises ChecklistConfigError when unusable."""
    source = os.environ if env is None else env

    def value(name: str) -> str:
        return (source.get(name) or "").strip()

    def setting(name: str) -> str:
        override = OVERRIDES.get(name)
        return (override and value(override)) or value(name)

    problems = []
    vertex = value("GOOGLE_GENAI_USE_VERTEXAI")
    if vertex.lower() not in ("true", "1"):
        problems.append(
            "GOOGLE_GENAI_USE_VERTEXAI must be TRUE: Gemini runs on Vertex AI "
            "with Application Default Credentials, never with an API key"
        )
    project = setting("GOOGLE_CLOUD_PROJECT")
    if not project:
        problems.append("missing GOOGLE_CLOUD_PROJECT (or CHECKLIST_GEMINI_PROJECT)")
    model = value("CHECKLIST_AGENT_MODEL") or DEFAULT_MODEL
    if not _MODEL.fullmatch(model):
        problems.append("CHECKLIST_AGENT_MODEL is not a Gemini model ID")
    thinking = (value("CHECKLIST_AGENT_THINKING") or DEFAULT_THINKING).lower()
    if thinking not in THINKING_MODES:
        problems.append("CHECKLIST_AGENT_THINKING must be low or default")
    database = value("FIRESTORE_DATABASE_ID") or DEFAULT_DATABASE
    if not _DATABASE.fullmatch(database):
        problems.append("FIRESTORE_DATABASE_ID is not a Firestore database ID")
    if problems:
        raise ChecklistConfigError(
            "The onboarding checklist agent cannot start: "
            + "; ".join(problems)
            + ". Set them in the repository .env (see .env.example) or in the "
            "agent's environment."
        )
    return ChecklistConfig(
        model=model,
        project=project,
        location=setting("GOOGLE_CLOUD_LOCATION") or DEFAULT_LOCATION,
        firestore_project=value("FIRESTORE_PROJECT_ID") or project,
        firestore_database=database,
        thinking=thinking,
    )
