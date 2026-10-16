"""The agent's configuration, the Agent Engine entrypoint and the deploy
command (arguments, environment, config, staging, create or update). No
network, no Google credentials, no Gemini."""

import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.adk.cli.utils.agent_loader import AgentLoader

import deploy_agent_engine as deploy
from conftest import AGENT_ROOT, TEST_ENV
from onboarding_checklist import agent as agent_module
from onboarding_checklist.agent import TOOL_NAMES, build_agent
from onboarding_checklist.config import ChecklistConfigError, load_config
from onboarding_checklist.instruction import INSTRUCTION

FLAGS = [
    "--project",
    "onboard-ai-synthetic",
    "--location",
    "asia-southeast1",
    "--display-name",
    "OnboardAi onboarding checklist (staging)",
    "--service-account",
    "onboardai-checklist-staging@onboard-ai-synthetic.iam.gserviceaccount.com",
    "--firestore-database",
    "onboardai-staging",
]
RESOURCE = "projects/123456789/locations/asia-southeast1/reasoningEngines/987654321"
NAME = "OnboardAi onboarding checklist (staging)"


def env(**changes):
    values = dict(TEST_ENV)
    values.update(changes)
    return {name: value for name, value in values.items() if value is not None}


# The agent ------------------------------------------------------------------------


def test_config_defaults_and_overrides():
    config = load_config(env(CHECKLIST_AGENT_MODEL=None, FIRESTORE_PROJECT_ID=None, FIRESTORE_DATABASE_ID=None))
    assert (config.model, config.project, config.location) == (
        "gemini-3.8-flash",
        "synthetic-test-project",
        "global",
    )
    assert (config.firestore_project, config.firestore_database) == ("synthetic-test-project", "(default)")
    # On Agent Engine GOOGLE_CLOUD_* are the engine's own project and region.
    engine = load_config(
        env(
            GOOGLE_CLOUD_PROJECT="123456789",
            GOOGLE_CLOUD_LOCATION="asia-southeast1",
            CHECKLIST_GEMINI_PROJECT="onboard-ai-synthetic",
            CHECKLIST_GEMINI_LOCATION="global",
        )
    )
    assert (engine.project, engine.location) == ("onboard-ai-synthetic", "global")
    model = build_agent(engine, store=object()).model
    assert model.model == "gemini-test-model"
    assert model.client_kwargs == {"enterprise": True, "project": "onboard-ai-synthetic", "location": "global"}


def test_unusable_settings_fail_with_one_message():
    with pytest.raises(ChecklistConfigError) as error:
        load_config({"GOOGLE_GENAI_USE_VERTEXAI": "false", "CHECKLIST_AGENT_MODEL": "Bad Model!"})
    message = str(error.value)
    assert "GOOGLE_GENAI_USE_VERTEXAI must be TRUE" in message
    assert "missing GOOGLE_CLOUD_PROJECT" in message
    assert "CHECKLIST_AGENT_MODEL is not a Gemini model ID" in message
    with pytest.raises(ChecklistConfigError, match="FIRESTORE_DATABASE_ID"):
        load_config(env(FIRESTORE_DATABASE_ID="../x"))


def test_the_agent_has_exactly_the_two_tools_and_no_state_placeholders():
    built = build_agent(load_config(TEST_ENV), store=object())
    assert [tool.name for tool in built.tools] == list(TOOL_NAMES)
    assert built.generate_content_config.temperature == 0.0
    # ADK would fill {placeholders} from the session state, which holds the account id.
    assert "{" not in INSTRUCTION and "}" not in INSTRUCTION
    assert "mark_step" in INSTRUCTION and "get_onboarding_progress" in INSTRUCTION


def test_adk_loads_root_agent_from_the_package_like_adk_api_server():
    loaded = AgentLoader(str(AGENT_ROOT)).load_agent("onboarding_checklist")
    assert loaded is agent_module.root_agent


def test_importing_the_agent_without_settings_stops_with_the_message():
    clean = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(AGENT_ROOT)}
    result = subprocess.run(
        [sys.executable, "-B", "-c", "import onboarding_checklist"],
        cwd=str(AGENT_ROOT),
        env=clean,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode != 0
    assert "ChecklistConfigError: The onboarding checklist agent cannot start" in result.stderr


def test_entrypoint_wraps_root_agent_in_adk_app(monkeypatch):
    import google.auth
    import vertexai
    from google.auth.credentials import AnonymousCredentials
    from vertexai.agent_engines import AdkApp

    monkeypatch.setattr(
        google.auth, "default", lambda *a, **k: (AnonymousCredentials(), "synthetic-test-project")
    )
    vertexai.init(project="synthetic-test-project", location="asia-southeast1")
    from onboarding_checklist import agent_engine_app

    assert isinstance(agent_engine_app.app, AdkApp)
    assert agent_engine_app.app._tmpl_attrs["agent"] is agent_module.root_agent
    operations = agent_engine_app.app.register_operations()
    assert "async_stream_query" in operations["async_stream"]
    assert {"async_create_session", "async_delete_session"} <= set(operations["async"])


def test_the_local_adk_server_never_imports_the_agent_engine_sdk():
    clean = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(AGENT_ROOT), **TEST_ENV}
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-c",
            "import sys, onboarding_checklist; "
            "print('agent_engine_app' in str(sorted(sys.modules)), 'vertexai' in sys.modules)",
        ],
        cwd=str(AGENT_ROOT),
        env=clean,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["False", "False"]


# Deploy command: arguments, environment, config -----------------------------------


def test_deploy_arguments_and_defaults():
    args = deploy.parse_args(FLAGS)
    assert (args.project, args.location, args.display_name) == (
        "onboard-ai-synthetic",
        "asia-southeast1",
        NAME,
    )
    assert args.service_account == "onboardai-checklist-staging@onboard-ai-synthetic.iam.gserviceaccount.com"
    assert args.firestore_database == "onboardai-staging"
    assert (args.model, args.gemini_location) == ("gemini-3.8-flash", "global")


@pytest.mark.parametrize(
    "flag,value",
    [
        ("--project", "Bad_Project"),
        ("--location", "global"),
        ("--display-name", "bad/name"),
        ("--service-account", "not-an-email"),
        ("--firestore-database", "../db"),
        ("--model", "Gemini Pro!"),
    ],
)
def test_deploy_rejects_invalid_arguments(flag, value, capsys):
    flags = list(FLAGS)
    if flag in flags:
        flags[flags.index(flag) + 1] = value
    else:
        flags += [flag, value]
    with pytest.raises(SystemExit) as stop:
        deploy.parse_args(flags)
    assert stop.value.code == 2
    assert "not a valid" in capsys.readouterr().err


def test_deploy_requires_every_required_flag(capsys):
    for index in range(0, len(FLAGS), 2):
        flags = FLAGS[:index] + FLAGS[index + 2 :]
        with pytest.raises(SystemExit):
            deploy.parse_args(flags)
        assert FLAGS[index] in capsys.readouterr().err


def test_agent_environment_has_no_secrets_and_no_reserved_names():
    env_vars = deploy.agent_env_vars(deploy.parse_args(FLAGS))
    assert env_vars == {
        "GOOGLE_GENAI_USE_VERTEXAI": "TRUE",
        "CHECKLIST_AGENT_MODEL": "gemini-3.8-flash",
        "CHECKLIST_GEMINI_PROJECT": "onboard-ai-synthetic",
        "CHECKLIST_GEMINI_LOCATION": "global",
        "FIRESTORE_PROJECT_ID": "onboard-ai-synthetic",
        "FIRESTORE_DATABASE_ID": "onboardai-staging",
        "ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS": "false",
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT": "false",
        "GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "false",
    }
    assert not set(env_vars) & deploy.RESERVED_ENV
    # The deployed agent starts with this plus what Agent Engine sets itself.
    config = load_config(
        {**env_vars, "GOOGLE_CLOUD_PROJECT": "123456789", "GOOGLE_CLOUD_LOCATION": "asia-southeast1"}
    )
    assert (config.project, config.location, config.model) == (
        "onboard-ai-synthetic",
        "global",
        "gemini-3.8-flash",
    )
    assert (config.firestore_project, config.firestore_database) == ("onboard-ai-synthetic", "onboardai-staging")


def test_runtime_config_deploys_the_package_from_source():
    args = deploy.parse_args(FLAGS)
    methods = [{"name": "async_create_session", "api_mode": "async"}]
    config = deploy.runtime_config(args, methods)
    assert config == {
        "display_name": NAME,
        "description": deploy.DESCRIPTION,
        "labels": {"app": "onboardai", "component": "onboarding-checklist"},
        "source_packages": ["onboarding_checklist", "requirements.txt"],
        "entrypoint_module": "onboarding_checklist.agent_engine_app",
        "entrypoint_object": "app",
        "requirements_file": "requirements.txt",
        "class_methods": methods,
        "agent_framework": "google-adk",
        "python_version": "3.13",
        "env_vars": deploy.agent_env_vars(args),
        "service_account": "onboardai-checklist-staging@onboard-ai-synthetic.iam.gserviceaccount.com",
        "min_instances": 0,
        "max_instances": 2,
        "resource_limits": {"cpu": "1", "memory": "2Gi"},
        "container_concurrency": 3,
    }
    from agentplatform._genai import types

    types.AgentRuntimeConfig.model_validate(config)


def test_class_methods_are_the_four_the_api_calls():
    methods = deploy.class_methods_spec("synthetic-test-project", "asia-southeast1")
    assert [(m["name"], m["api_mode"]) for m in methods] == [
        ("async_create_session", "async"),
        ("async_stream_query", "async_stream"),
        ("async_delete_session", "async"),
        ("async_list_sessions", "async"),
    ]
    create, stream, delete, listing = (m["parameters"]["properties"] for m in methods)
    assert "user_id" in listing
    # Reading a session (its events hold the employee's messages) is not exposed.
    assert "async_get_session" not in deploy.CLASS_METHODS
    # The api sets the employee's account id and track in the session state.
    assert {"user_id", "session_id", "state", "ttl"} <= set(create)
    assert {"user_id", "session_id", "message", "run_config"} <= set(stream)
    assert {"user_id", "session_id"} <= set(delete)


def test_requirements_are_exported_from_the_lock_with_exact_versions(tmp_path):
    target = tmp_path / "requirements.txt"
    deploy.export_requirements(target)
    lines = [line for line in target.read_text().splitlines() if line and not line.startswith("#")]
    assert "google-adk==2.12.0" in lines
    assert "google-cloud-firestore==2.34.1" in lines
    assert "google-cloud-aiplatform==2.5.0" in lines
    assert not any(line.startswith("pytest") for line in lines)
    assert all("==" in line for line in lines)


def test_staging_copies_the_package_without_caches_or_env_files(tmp_path):
    package = AGENT_ROOT / "onboarding_checklist"
    cache = package / "__pycache__"
    made_cache = not cache.exists()
    cache.mkdir(exist_ok=True)
    stray = package / ".env"
    stray.write_text("FIRESTORE_DATABASE_ID=never-deployed\n")
    try:
        deploy.stage_source(tmp_path, export=lambda path: path.write_text("google-adk==2.12.0\n"))
    finally:
        stray.unlink()
        if made_cache:
            cache.rmdir()
    staged = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*"))
    assert staged == [
        "onboarding_checklist",
        "onboarding_checklist/__init__.py",
        "onboarding_checklist/agent.py",
        "onboarding_checklist/agent_engine_app.py",
        "onboarding_checklist/config.py",
        "onboarding_checklist/instruction.py",
        "onboarding_checklist/rules.py",
        "onboarding_checklist/store.py",
        "onboarding_checklist/tools.py",
        "requirements.txt",
    ]


# Deploy command: create or update -------------------------------------------------


class FakeRuntimes:
    def __init__(self, existing=()):
        self.existing = list(existing)
        self.calls = []

    def list(self, config):
        self.calls.append(("list", config))
        return [
            SimpleNamespace(api_resource=SimpleNamespace(name=name, display_name=display))
            for name, display in self.existing
        ]

    def _deployed(self, kind, name, config):
        present = [Path(path).exists() for path in config["source_packages"]]
        self.calls.append((kind, name, config, present, Path.cwd()))
        return SimpleNamespace(api_resource=SimpleNamespace(name=name or RESOURCE))

    def create(self, config):
        return self._deployed("create", None, config)

    def update(self, name, config):
        return self._deployed("update", name, config)


def run_deploy(runtimes):
    def stage(directory):
        (directory / "onboarding_checklist").mkdir()
        (directory / "requirements.txt").write_text("google-adk==2.12.0\n")

    return deploy.deploy(
        deploy.parse_args(FLAGS),
        client=SimpleNamespace(runtimes=runtimes),
        class_methods=[{"name": "async_stream_query", "api_mode": "async_stream"}],
        stage=stage,
        log=lambda line: None,
    )


def test_deploy_creates_the_instance_when_none_has_the_display_name():
    runtimes = FakeRuntimes(existing=[("projects/1/locations/asia-southeast1/reasoningEngines/5", "Other agent")])
    cwd = Path.cwd()
    assert run_deploy(runtimes) == RESOURCE
    assert runtimes.calls[0] == ("list", {"filter": f'display_name="{NAME}"'})
    kind, name, config, present, workdir = runtimes.calls[1]
    assert (kind, name, present) == ("create", None, [True, True])
    assert workdir != cwd and Path.cwd() == cwd
    assert config["display_name"] == NAME


def test_deploy_updates_the_instance_with_the_display_name():
    existing = "projects/123456789/locations/asia-southeast1/reasoningEngines/42"
    runtimes = FakeRuntimes(existing=[(existing, NAME)])
    assert run_deploy(runtimes) == existing
    kind, name, config, present, _ = runtimes.calls[1]
    assert (kind, name, present) == ("update", existing, [True, True])
    assert config["env_vars"]["FIRESTORE_DATABASE_ID"] == "onboardai-staging"


def test_deploy_stops_when_two_instances_share_the_display_name():
    runtimes = FakeRuntimes(
        existing=[
            ("projects/1/locations/asia-southeast1/reasoningEngines/1", NAME),
            ("projects/1/locations/asia-southeast1/reasoningEngines/2", NAME),
        ]
    )
    with pytest.raises(deploy.DeployError, match="2 Agent Engine instances"):
        run_deploy(runtimes)
    assert [call[0] for call in runtimes.calls] == ["list"]


def test_main_prints_only_the_resource_name_last_on_stdout(monkeypatch, capsys):
    monkeypatch.setattr(deploy, "deploy", lambda args: RESOURCE)
    assert deploy.main(FLAGS) == 0
    captured = capsys.readouterr()
    assert captured.out == RESOURCE + "\n"
    assert captured.out.splitlines()[-1] == RESOURCE

    def fail(args):
        raise deploy.DeployError("2 Agent Engine instances are named 'x'")

    monkeypatch.setattr(deploy, "deploy", fail)
    assert deploy.main(FLAGS) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("Deploy failed: 2 Agent Engine instances")


def test_generation_settings_thinking_and_output_cap():
    from google.genai import types

    from onboarding_checklist.agent import MAX_OUTPUT_TOKENS, generation_config
    from onboarding_checklist.config import ChecklistConfigError, load_config

    default = load_config(TEST_ENV)
    assert default.thinking == "default"
    config = generation_config(default)
    assert (config.temperature, config.max_output_tokens, config.thinking_config) == (
        0.0,
        MAX_OUTPUT_TOKENS,
        None,
    )
    low = load_config({**TEST_ENV, "CHECKLIST_AGENT_THINKING": "LOW"})
    assert generation_config(low).thinking_config.thinking_level == types.ThinkingLevel.LOW
    with pytest.raises(ChecklistConfigError, match="CHECKLIST_AGENT_THINKING"):
        load_config({**TEST_ENV, "CHECKLIST_AGENT_THINKING": "minimal"})


def test_the_instruction_orders_its_rules_so_a_passed_check_is_simply_done():
    lines = [line.strip() for line in INSTRUCTION.split("\n")]
    text = " ".join(lines)
    assert "follow the FIRST one that applies" in text
    order = [
        text.index('status is already "done"'),
        text.index('completion is "check"'),
        text.index("briefing_needed is true"),
        text.index("Otherwise call mark_step"),
    ]
    assert order == sorted(order)
