"""The root agent: Gemini on Vertex AI with the two checklist tools."""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.models import Gemini
from google.genai import types

from .config import ChecklistConfig, load_config
from .instruction import INSTRUCTION
from .store import ChecklistStore
from .tools import build_tools

AGENT_NAME = "onboarding_checklist"
TOOL_NAMES = ("get_onboarding_progress", "mark_step")


def build_model(config: ChecklistConfig) -> Gemini:
    """Gemini on Vertex AI in the configured project and location.

    Passed to google-genai explicitly, so the GOOGLE_CLOUD_LOCATION that Agent
    Engine sets to its own region never decides where Gemini is called.
    """
    return Gemini(
        model=config.model,
        client_kwargs={
            "enterprise": True,
            "project": config.project,
            "location": config.location,
        },
    )


# The reply is two short sentences. The cap (thinking tokens count towards it)
# stops a run from thinking for minutes: a passed check step once took 7,700
# thought tokens and 93 s before this cap and the ordered rules.
MAX_OUTPUT_TOKENS = 1024


def generation_config(config: ChecklistConfig) -> types.GenerateContentConfig:
    """Temperature 0, at most MAX_OUTPUT_TOKENS, and thinkingLevel LOW when
    CHECKLIST_AGENT_THINKING=low."""
    return types.GenerateContentConfig(
        temperature=config.temperature,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        thinking_config=(
            types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
            if config.thinking == "low"
            else None
        ),
    )


def build_store(config: ChecklistConfig) -> ChecklistStore:
    return ChecklistStore(project=config.firestore_project, database=config.firestore_database)


def build_agent(config: ChecklistConfig, store: ChecklistStore | None = None, model=None) -> LlmAgent:
    return LlmAgent(
        name=AGENT_NAME,
        model=model if model is not None else build_model(config),
        description=(
            "Updates an OnboardAi employee's onboarding checklist when they say "
            "they finished an activity, after the employee approves the change."
        ),
        instruction=INSTRUCTION,
        generate_content_config=generation_config(config),
        tools=build_tools(store if store is not None else build_store(config)),
    )


root_agent = build_agent(load_config())
