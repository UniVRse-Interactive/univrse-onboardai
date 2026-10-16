"""The entrypoint Vertex AI Agent Engine runs: `root_agent` wrapped in AdkApp.

`npm run checklist-agent:deploy` deploys this package from source with
entrypoint_module "onboarding_checklist.agent_engine_app" and entrypoint_object
"app". Agent Engine imports it on its own runtime, so `root_agent` is built
there from the agent's environment; nothing is pickled locally.

AdkApp keeps the sessions in Agent Engine's managed Sessions service. The
OnboardAi API creates one session per proposed change (with the employee's
account id and track in its state), resumes it with the employee's answer and
deletes it afterwards. Only `adk api_server` is used locally; it never imports
this module.
"""

from vertexai.agent_engines import AdkApp

from .agent import root_agent

app = AdkApp(agent=root_agent)
