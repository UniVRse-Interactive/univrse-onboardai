"""OnboardAi onboarding checklist agent (Google ADK).

`adk api_server` and `adk deploy agent_engine` load `root_agent` from
`onboarding_checklist.agent`. Importing it reads the configuration from the
environment and fails with a clear message when something is missing.
"""

from . import agent

__all__ = ["agent"]
