"""Create or update the onboarding checklist agent on Vertex AI Agent Engine.

Run it from the repository root with `npm run checklist-agent:deploy -- <flags>`
(scripts/deploy-checklist-agent.mjs), which runs this file with uv and the
locked `deploy` dependency group:

    --project <id> --location <region> --display-name <name>
    --service-account <email> --firestore-database <id>
    [--model <gemini model, default gemini-3.8-flash>]
    [--gemini-location <location, default global>]

- Idempotent: the Agent Engine instance with that display name is updated,
  or created when there is none. Two instances with the name stop the deploy.
- Deployed from source files (no Cloud Storage bucket): the
  `onboarding_checklist` package and a requirements.txt exported from uv.lock
  (the main dependencies plus the `deploy` group, exact versions). Agent
  Engine imports `onboarding_checklist.agent_engine_app:app`, an AdkApp around
  `root_agent`, and builds the agent from its own environment.
- The agent's environment: GOOGLE_GENAI_USE_VERTEXAI, CHECKLIST_AGENT_MODEL,
  CHECKLIST_GEMINI_PROJECT and CHECKLIST_GEMINI_LOCATION (Agent Engine reserves
  GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION and sets them to its own
  project and region), FIRESTORE_PROJECT_ID and FIRESTORE_DATABASE_ID, and
  switches that keep message content out of logs and traces. There are no
  secrets: the runtime service account reads and writes Firestore and calls
  Gemini.
- Only the four AdkApp methods the OnboardAi API calls are exposed
  (create a session with state, stream a query or a confirmation, delete,
  and list an employee's sessions so they can be deleted with the employee).
- Progress goes to standard error. The last line on standard output is only
  the resource name projects/.../locations/.../reasoningEngines/..., so a
  workflow can capture it.
"""

from __future__ import annotations

import argparse
import contextlib
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

AGENT_ROOT = Path(__file__).resolve().parent
PACKAGE = "onboarding_checklist"
ENTRYPOINT_MODULE = "onboarding_checklist.agent_engine_app"
ENTRYPOINT_OBJECT = "app"
REQUIREMENTS_FILE = "requirements.txt"
PYTHON_VERSION = "3.13"
AGENT_FRAMEWORK = "google-adk"
DEFAULT_MODEL = "gemini-3.8-flash"
DEFAULT_GEMINI_LOCATION = "global"
DESCRIPTION = (
    "OnboardAi onboarding checklist: marks an employee's onboarding step, "
    "after the employee approves, when they tell Alya they finished it."
)
LABELS = {"app": "onboardai", "component": "onboarding-checklist"}
# The AdkApp methods the OnboardAi API calls (server/checklist-agent-client.mjs).
# Listing is only for deleting an employee's sessions; reading a session (its
# events hold the employee's messages) is never exposed.
CLASS_METHODS = (
    "async_create_session",
    "async_stream_query",
    "async_delete_session",
    "async_list_sessions",
)
# Completion reports arrive now and then: scale to zero, at most two small instances.
SCALING = {
    "min_instances": 0,
    "max_instances": 2,
    "resource_limits": {"cpu": "1", "memory": "2Gi"},
    "container_concurrency": 3,
}
# Set by Agent Engine itself; the deploy must never set them.
RESERVED_ENV = frozenset(
    {
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_QUOTA_PROJECT",
        "GOOGLE_CLOUD_LOCATION",
        "PORT",
        "K_SERVICE",
        "K_REVISION",
        "K_CONFIGURATION",
        "GOOGLE_APPLICATION_CREDENTIALS",
    }
)
RESOURCE_NAME = re.compile(
    r"^projects/[^/\s]+/locations/[a-z0-9-]+/reasoningEngines/[0-9]+$"
)

_PROJECT = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
_REGION = re.compile(r"^[a-z]+-[a-z]+[0-9]+$")
_GEMINI_LOCATION = re.compile(r"^(global|us|eu|[a-z]+-[a-z]+[0-9]+)$")
_DISPLAY_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,127}$")
_SERVICE_ACCOUNT = re.compile(r"^[a-z0-9][a-z0-9-]{4,61}@[a-z0-9.-]+\.gserviceaccount\.com$")
_DATABASE = re.compile(r"^(\(default\)|[a-z][a-z0-9-]{3,62})$")
_MODEL = re.compile(r"^[a-z0-9][a-z0-9.-]{0,127}$")


class DeployError(Exception):
    """The deploy cannot go on; the message names the problem, never a secret."""


def _checked(pattern: re.Pattern[str], what: str) -> Callable[[str], str]:
    def check(value: str) -> str:
        text = value.strip()
        if not pattern.fullmatch(text):
            raise argparse.ArgumentTypeError(f"not a valid {what}")
        return text

    return check


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="npm run checklist-agent:deploy --",
        description=(
            "Create or update the onboarding checklist agent on Vertex AI Agent "
            "Engine. The last line on standard output is the resource name."
        ),
    )
    required = parser.add_argument_group("required")
    required.add_argument("--project", required=True, type=_checked(_PROJECT, "project ID"))
    required.add_argument(
        "--location",
        required=True,
        type=_checked(_REGION, "region (for example asia-southeast1)"),
        help="Agent Engine region",
    )
    required.add_argument(
        "--display-name",
        required=True,
        type=_checked(_DISPLAY_NAME, "display name (letters, digits, spaces and . _ ( ) -)"),
        help="identifies the instance to update",
    )
    required.add_argument(
        "--service-account",
        required=True,
        type=_checked(_SERVICE_ACCOUNT, "service account email"),
        help="the agent's runtime identity",
    )
    required.add_argument(
        "--firestore-database",
        required=True,
        type=_checked(_DATABASE, "Firestore database ID"),
        help="the environment's Firestore database in the same project",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        type=_checked(_MODEL, "Gemini model ID"),
        help=f"default {DEFAULT_MODEL}",
    )
    parser.add_argument(
        "--gemini-location",
        default=DEFAULT_GEMINI_LOCATION,
        type=_checked(_GEMINI_LOCATION, "Gemini location"),
        help=f"where Gemini is called, default {DEFAULT_GEMINI_LOCATION}",
    )
    return parser


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    return build_parser().parse_args(argv)


def agent_env_vars(args: argparse.Namespace) -> dict[str, Any]:
    """The deployed agent's environment. There are no secrets."""
    return {
        "GOOGLE_GENAI_USE_VERTEXAI": "TRUE",
        "CHECKLIST_AGENT_MODEL": args.model,
        "CHECKLIST_GEMINI_PROJECT": args.project,
        "CHECKLIST_GEMINI_LOCATION": args.gemini_location,
        "FIRESTORE_PROJECT_ID": args.project,
        "FIRESTORE_DATABASE_ID": args.firestore_database,
        # No message content (the employee's words) in traces or telemetry logs.
        "ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS": "false",
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT": "false",
        "GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "false",
    }


def runtime_config(
    args: argparse.Namespace, class_methods: list[dict[str, Any]]
) -> dict[str, Any]:
    """The config for client.runtimes.create / update (deploy from source files).

    Paths are relative to the staging directory (see stage_source).
    """
    return {
        "display_name": args.display_name,
        "description": DESCRIPTION,
        "labels": dict(LABELS),
        "source_packages": [PACKAGE, REQUIREMENTS_FILE],
        "entrypoint_module": ENTRYPOINT_MODULE,
        "entrypoint_object": ENTRYPOINT_OBJECT,
        "requirements_file": REQUIREMENTS_FILE,
        "class_methods": class_methods,
        "agent_framework": AGENT_FRAMEWORK,
        "python_version": PYTHON_VERSION,
        "env_vars": agent_env_vars(args),
        "service_account": args.service_account,
        **{key: (dict(value) if isinstance(value, dict) else value) for key, value in SCALING.items()},
    }


def class_methods_spec(project: str, location: str) -> list[dict[str, Any]]:
    """The schemas of CLASS_METHODS, generated from the installed AdkApp.

    The schemas come from the AdkApp method signatures, so a placeholder agent
    is enough: the real one is built on Agent Engine from its environment.
    """
    import vertexai
    from agentplatform._genai import _runtimes_utils
    from google.adk.agents import LlmAgent
    from vertexai.agent_engines import AdkApp

    vertexai.init(project=project, location=location)
    app = AdkApp(agent=LlmAgent(name="schema_only", model="schema-only"))
    specs = _runtimes_utils._generate_class_methods_spec_or_raise(
        agent=app, operations=app.register_operations()
    )
    methods = [_runtimes_utils._to_dict(spec) for spec in specs]
    chosen = [method for method in methods if method.get("name") in CLASS_METHODS]
    missing = sorted(set(CLASS_METHODS) - {method["name"] for method in chosen})
    if missing:
        raise DeployError(f"the installed AdkApp does not offer {', '.join(missing)}")
    for method in chosen:
        # async_create_session takes ttl through **kwargs, which the generated
        # schema leaves out; declare it as ADK's own deploy catalogue does.
        # Its state parameter (the employee's account id and track) is in the
        # generated schema.
        if method["name"] == "async_create_session":
            method["parameters"].setdefault("properties", {})["ttl"] = {
                "type": "string",
                "nullable": True,
            }
    return sorted(chosen, key=lambda method: CLASS_METHODS.index(method["name"]))


def export_requirements(target: Path) -> None:
    """requirements.txt from uv.lock: main dependencies plus the deploy group."""
    uv = os.environ.get("UV") or shutil.which("uv")
    if not uv:
        raise DeployError("uv is not installed or not on PATH")
    subprocess.run(
        [
            uv,
            "export",
            "--locked",
            "--no-dev",
            "--group",
            "deploy",
            "--no-hashes",
            "--no-emit-project",
            "--no-header",
            "--no-annotate",
            "--quiet",
            "--format",
            "requirements.txt",
            "--output-file",
            str(target),
        ],
        cwd=AGENT_ROOT,
        check=True,
        stdout=sys.stderr,
    )


def stage_source(
    directory: Path, export: Callable[[Path], None] = export_requirements
) -> None:
    """Copies the agent package (no caches, no .env files) and the requirements."""
    shutil.copytree(
        AGENT_ROOT / PACKAGE,
        directory / PACKAGE,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".env", ".env.*"),
    )
    export(directory / REQUIREMENTS_FILE)


def find_engine(client: Any, display_name: str) -> str | None:
    """The resource name of the instance with this display name, or None."""
    names = [
        runtime.api_resource.name
        for runtime in client.runtimes.list(config={"filter": f'display_name="{display_name}"'})
        if runtime.api_resource.display_name == display_name
    ]
    if len(names) > 1:
        raise DeployError(
            f"{len(names)} Agent Engine instances are named {display_name!r}; "
            "delete or rename all but one, then deploy again"
        )
    return names[0] if names else None


def deploy(
    args: argparse.Namespace,
    *,
    client: Any = None,
    class_methods: list[dict[str, Any]] | None = None,
    stage: Callable[[Path], None] = stage_source,
    log: Callable[[str], None] = lambda line: print(line, file=sys.stderr, flush=True),
) -> str:
    """Creates or updates the instance; returns its resource name."""
    if client is None:
        import agentplatform

        client = agentplatform.Client(project=args.project, location=args.location)
    methods = class_methods if class_methods is not None else class_methods_spec(
        args.project, args.location
    )
    existing = find_engine(client, args.display_name)
    with tempfile.TemporaryDirectory(prefix="checklist-agent-deploy-") as staging:
        stage(Path(staging))
        config = runtime_config(args, methods)
        # The SDK archives source_packages relative to the working directory.
        with contextlib.chdir(staging):
            if existing:
                log(f"Updating {existing} …")
                runtime = client.runtimes.update(name=existing, config=config)
            else:
                log(f"Creating {args.display_name!r} in {args.project}/{args.location} …")
                runtime = client.runtimes.create(config=config)
    name = getattr(getattr(runtime, "api_resource", None), "name", None) or existing
    if not name or not RESOURCE_NAME.fullmatch(name):
        raise DeployError("Agent Engine did not return a resource name")
    return name


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(message)s")
    try:
        name = deploy(args)
    except DeployError as error:
        print(f"Deploy failed: {error}.", file=sys.stderr)
        return 1
    print(f"Deployed the checklist agent: {name}", file=sys.stderr, flush=True)
    # The only output on standard output, and its last line.
    print(name, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
