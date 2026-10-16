"""The ADK tool-confirmation round trip, with a scripted model instead of
Gemini and an in-memory Firestore:

1. the employee's message runs get_onboarding_progress, then mark_step, which
   stops with an adk_request_confirmation call and changes nothing;
2. the run is resumed with the confirmation FunctionResponse: approved writes
   the step, declined does not.

It runs through ADK's Runner (what `adk api_server` serves on /run) and through
vertexai's AdkApp with JSON messages (the code Agent Engine runs behind
:query and :streamQuery)."""

import asyncio
import json

import pytest
from google.adk.models import BaseLlm, LlmResponse
from google.adk.models._capabilities import LlmCapabilities
from google.adk.runners import InMemoryRunner
from google.genai import types

from conftest import ACCOUNT, BRIEFED_AT, NOW, TEST_ENV, briefed, make_store
from onboarding_checklist.agent import AGENT_NAME, build_agent
from onboarding_checklist.config import load_config
from onboarding_checklist.tools import ACCOUNT_KEY, TRACK_KEY

CONFIRMATION = "adk_request_confirmation"
# Every request the scripted model received, as JSON.
SEEN: list[str] = []
STATE = {ACCOUNT_KEY: ACCOUNT, TRACK_KEY: "employee"}


class ScriptedLlm(BaseLlm):
    """Reads the checklist, then marks the step the message names, then
    answers from the tool's result. No model, no network."""

    model: str = "scripted"

    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request, stream=False):
        contents = llm_request.contents
        SEEN.append(json.dumps([c.model_dump(mode="json", exclude_none=True) for c in contents]))
        message = next(
            (p.text for c in contents if c.role == "user" for p in c.parts or [] if p.text),
            "",
        ).lower()
        last = contents[-1]
        responses = [p.function_response for p in last.parts or [] if p.function_response]
        if responses and responses[0].name == "mark_step":
            result = responses[0].response or {}
            if "error" in result:
                text = "Okay, I left it unchanged."
            elif result.get("result") == "check_required":
                text = "That one is a short scenario check: take it on your dashboard."
            elif result.get("result") == "briefing_required":
                text = result["message"]
            else:
                text = f"Done: {result.get('title')} is {result.get('status')}."
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))
            return
        if responses and responses[0].name == "get_onboarding_progress":
            step = (
                "team-support.meet-buddy"
                if "buddy" in message
                else "documentation.contract"
                if "contract" in message
                else "policies.employee-handbook"
            )
            yield LlmResponse(
                content=types.Content(
                    role="model",
                    parts=[
                        types.Part(
                            function_call=types.FunctionCall(name="mark_step", args={"step_id": step})
                        )
                    ],
                )
            )
            return
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[types.Part(function_call=types.FunctionCall(name="get_onboarding_progress", args={}))],
            )
        )


def agent_with(store):
    return build_agent(load_config(TEST_ENV), store=store, model=ScriptedLlm())


def text_of(content):
    return "".join(p.text or "" for p in (content.parts or []) if not p.thought)


async def run(runner, session_id, message):
    events = []
    async for event in runner.run_async(user_id="employee-x", session_id=session_id, new_message=message):
        events.append(event)
    return events


def user_text(text):
    return types.Content(role="user", parts=[types.Part(text=text)])


def confirmation_answer(call_id, confirmed):
    return types.Content(
        role="user",
        parts=[
            types.Part(
                function_response=types.FunctionResponse(
                    id=call_id, name=CONFIRMATION, response={"confirmed": confirmed}
                )
            )
        ],
    )


def confirmation_calls(events):
    return [
        call
        for event in events
        for call in event.get_function_calls()
        if call.name == CONFIRMATION
    ]


BRIEFING = {"briefedAt": BRIEFED_AT, "briefedBy": "listened"}


def statuses(db):
    steps = (db.documents.get(f"onboardingProgress/{ACCOUNT}") or {}).get("steps") or {}
    return {step_id: entry["status"] for step_id, entry in steps.items() if "status" in entry}


@pytest.mark.parametrize("confirmed", [True, False])
def test_runner_round_trip_waits_for_the_employee(confirmed):
    db, store = make_store(briefed("team-support.meet-buddy"))
    runner = InMemoryRunner(agent=agent_with(store), app_name=AGENT_NAME)

    async def scenario():
        session = await runner.session_service.create_session(
            app_name=AGENT_NAME, user_id="employee-x", state=STATE
        )
        first = await run(runner, session.id, user_text("I've met my buddy today"))
        calls = confirmation_calls(first)
        assert len(calls) == 1
        original = calls[0].args["originalFunctionCall"]
        assert original["name"] == "mark_step"
        assert original["args"] == {"step_id": "team-support.meet-buddy"}
        # Nothing was written while the change waits for the employee.
        assert statuses(db) == {}
        assert db.transactions == []
        resumed = await run(runner, session.id, confirmation_answer(calls[0].id, confirmed))
        return "".join(text_of(e.content) for e in resumed if e.content and e.author == AGENT_NAME)

    reply = asyncio.run(scenario())
    if confirmed:
        assert reply == "Done: Meet your buddy is done."
        # The briefing fields stay on the step.
        assert db.documents[f"onboardingProgress/{ACCOUNT}"]["steps"] == {
            "team-support.meet-buddy": {
                "status": "done",
                "updatedAt": NOW,
                "source": "alya-agent",
                "actorId": ACCOUNT,
                **BRIEFING,
            }
        }
    else:
        assert reply == "Okay, I left it unchanged."
        assert statuses(db) == {}
    # The model never saw the account id from the state.
    assert SEEN and all(ACCOUNT not in seen for seen in SEEN)


def test_without_the_briefing_nothing_is_proposed_and_alya_points_to_it():
    db, store = make_store()
    runner = InMemoryRunner(agent=agent_with(store), app_name=AGENT_NAME)

    async def scenario():
        session = await runner.session_service.create_session(
            app_name=AGENT_NAME, user_id="employee-x", state=STATE
        )
        return await run(runner, session.id, user_text("I've met my buddy today"))

    events = asyncio.run(scenario())
    # No confirmation request, nothing read in a transaction, nothing written.
    assert confirmation_calls(events) == []
    assert db.transactions == []
    assert f"onboardingProgress/{ACCOUNT}" not in db.documents
    reply = "".join(text_of(e.content) for e in events if e.content and e.author == AGENT_NAME)
    assert reply == (
        "Before I mark it, please listen to Alya's briefing for Meet your buddy on your "
        "dashboard. Nothing was marked."
    )


def test_a_signed_contract_is_proposed_as_submitted_and_a_check_never_asks():
    db, store = make_store(briefed("documentation.contract"))
    runner = InMemoryRunner(agent=agent_with(store), app_name=AGENT_NAME)

    async def scenario():
        session = await runner.session_service.create_session(
            app_name=AGENT_NAME, user_id="employee-x", state=STATE
        )
        first = await run(runner, session.id, user_text("I signed my contract"))
        call = confirmation_calls(first)[0]
        await run(runner, session.id, confirmation_answer(call.id, True))
        other = await runner.session_service.create_session(
            app_name=AGENT_NAME, user_id="employee-x", state=STATE
        )
        check = await run(runner, other.id, user_text("I read the employee handbook"))
        return check

    check = asyncio.run(scenario())
    assert db.documents[f"onboardingProgress/{ACCOUNT}"]["steps"]["documentation.contract"]["status"] == (
        "submitted"
    )
    # A check step: no confirmation request, nothing marked, a pointer to the check.
    assert confirmation_calls(check) == []
    assert "scenario check" in "".join(text_of(e.content) for e in check if e.content)
    assert "policies.employee-handbook" not in db.documents[f"onboardingProgress/{ACCOUNT}"]["steps"]


def test_agent_engine_adk_app_resumes_a_confirmation_from_json():
    """AdkApp is what Agent Engine runs: async_create_session (with the state)
    and async_stream_query with a JSON Content, here a function_response."""
    vertexai_engines = pytest.importorskip("vertexai.agent_engines")
    db, store = make_store(briefed("team-support.meet-buddy"))
    app = vertexai_engines.AdkApp(agent=agent_with(store))

    async def scenario():
        session = await app.async_create_session(user_id="employee-x", state=STATE)
        first = [
            event
            async for event in app.async_stream_query(
                user_id="employee-x",
                session_id=session["id"],
                message={"role": "user", "parts": [{"text": "I've met my buddy"}]},
            )
        ]
        # JSON events: snake_case keys, the call's args as ADK built them.
        calls = [
            part["function_call"]
            for event in first
            for part in (event.get("content") or {}).get("parts", [])
            if part.get("function_call", {}).get("name") == CONFIRMATION
        ]
        assert len(calls) == 1
        assert calls[0]["args"]["originalFunctionCall"]["args"] == {"step_id": "team-support.meet-buddy"}
        assert statuses(db) == {}
        resumed = [
            event
            async for event in app.async_stream_query(
                user_id="employee-x",
                session_id=session["id"],
                message={
                    "role": "user",
                    "parts": [
                        {
                            "function_response": {
                                "id": calls[0]["id"],
                                "name": CONFIRMATION,
                                "response": {"confirmed": True},
                            }
                        }
                    ],
                },
            )
        ]
        await app.async_delete_session(user_id="employee-x", session_id=session["id"])
        return resumed

    resumed = asyncio.run(scenario())
    texts = [
        part.get("text", "")
        for event in resumed
        for part in (event.get("content") or {}).get("parts", [])
    ]
    assert "Done: Meet your buddy is done." in texts
    assert db.documents[f"onboardingProgress/{ACCOUNT}"]["steps"]["team-support.meet-buddy"]["status"] == "done"
