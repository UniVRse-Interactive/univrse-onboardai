"""The onboarding footprint rules the agent applies, identical to the API's
server/onboarding-progress.mjs (contract v1.3):

- a self step, or any optional step (required: false), becomes done;
- an hr_verify step becomes submitted (HR still verifies it);
- a check step is never marked: the employee takes its scenario check on the
  dashboard;
- a step already done (or already submitted for HR) is left as it is;
- a required step with a briefing needs Alya's briefing first (contract v1.5):
  until its progress record has briefedAt, it is never proposed or marked.

An area counts required steps only; it meets the threshold (70) at an exact
ratio; onboarding is complete when every area meets it. The next step is the
first required todo step of the first area below the threshold that still has
one, else the first required todo step anywhere.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

DONE = "done"
SUBMITTED = "submitted"
TODO = "todo"
DEFAULT_THRESHOLD = 70
AI_READINESS_STEP_ID = "role-tools.ai-readiness-training"


@dataclass(frozen=True)
class Step:
    id: str
    title: str
    area_id: str
    area_title: str
    completion: str
    required: bool
    briefing_required: bool = False


def steps_of(template: Mapping[str, Any]) -> list[Step]:
    """The template's steps in area and step order; malformed entries are skipped."""
    steps: list[Step] = []
    for area in template.get("areas") or []:
        if not isinstance(area, Mapping):
            continue
        for step in area.get("steps") or []:
            if not isinstance(step, Mapping) or not isinstance(step.get("id"), str):
                continue
            steps.append(
                Step(
                    id=step["id"],
                    title=str(step.get("title") or step["id"]),
                    area_id=str(area.get("id") or ""),
                    area_title=str(area.get("title") or ""),
                    completion=str(step.get("completion") or ""),
                    required=step.get("required") is not False,
                    briefing_required=step.get("required") is not False
                    and isinstance(step.get("briefing"), Mapping)
                    and bool(step["briefing"].get("text")),
                )
            )
    return steps


def find_step(template: Mapping[str, Any], step_id: str) -> Step | None:
    return next((step for step in steps_of(template) if step.id == step_id), None)


def record_of(progress: Mapping[str, Any] | None, step_id: str) -> Mapping[str, Any]:
    entry = ((progress or {}).get("steps") or {}).get(step_id)
    return entry if isinstance(entry, Mapping) else {}


def briefed(progress: Mapping[str, Any] | None, step_id: str) -> bool:
    """Whether the employee has had Alya's briefing of the step (briefedAt)."""
    value = record_of(progress, step_id).get("briefedAt")
    return isinstance(value, str) and bool(value)


def needs_briefing(step: Step, progress: Mapping[str, Any] | None) -> bool:
    """A required step with a briefing that the employee has not had yet, and
    that is not done or submitted already."""
    return (
        step.briefing_required
        and status_of(progress, step.id) == TODO
        and not briefed(progress, step.id)
    )


def status_of(progress: Mapping[str, Any] | None, step_id: str) -> str:
    if step_id == AI_READINESS_STEP_ID and isinstance((progress or {}).get("aiProficiency"), Mapping):
        return DONE if progress["aiProficiency"].get("trainingCompleted") is True else TODO
    entry = ((progress or {}).get("steps") or {}).get(step_id)
    if isinstance(entry, Mapping) and entry.get("status") in (DONE, SUBMITTED):
        return entry["status"]
    return TODO


def target_status(step: Step) -> str | None:
    """What marking the step sets it to, or None for a check step."""
    if not step.required or step.completion == "self":
        return DONE
    if step.completion == "hr_verify":
        return SUBMITTED
    return None


def can_propose(step: Step | None, progress: Mapping[str, Any] | None = None) -> bool:
    """Whether marking this step needs the employee's confirmation: it exists,
    is not a scenario check and needs no briefing first. Stable between the
    proposal and the answer (a briefing is never taken back)."""
    return (
        step is not None
        and target_status(step) is not None
        and not needs_briefing(step, progress)
    )


def summary(template: Mapping[str, Any], progress: Mapping[str, Any] | None) -> dict[str, Any]:
    """The checklist as the agent sees it: every step with its status, the area
    progress, whether onboarding is complete, and the next step."""
    threshold = template.get("threshold")
    if not isinstance(threshold, int) or not 1 <= threshold <= 100:
        threshold = DEFAULT_THRESHOLD
    steps = steps_of(template)
    areas: list[dict[str, Any]] = []
    first_below = first_anywhere = None
    for area_id in dict.fromkeys(step.area_id for step in steps):
        in_area = [step for step in steps if step.area_id == area_id]
        required = [step for step in in_area if step.required]
        done = sum(1 for step in required if status_of(progress, step.id) == DONE)
        ratio = done / len(required) if required else 1.0
        meets = ratio * 100 >= threshold - 1e-9
        todo = next((s for s in required if status_of(progress, s.id) == TODO), None)
        if todo and first_anywhere is None:
            first_anywhere = todo
        if todo and not meets and first_below is None:
            first_below = todo
        areas.append(
            {
                "id": area_id,
                "title": in_area[0].area_title,
                "done": done,
                "total": len(required),
                "meets_threshold": meets,
            }
        )
    nxt = first_below or first_anywhere
    return {
        "threshold": threshold,
        "complete": all(area["meets_threshold"] for area in areas),
        "areas": areas,
        "steps": [
            {
                "step_id": step.id,
                "title": step.title,
                "area": step.area_title,
                "completion": step.completion if step.required else "optional",
                "status": status_of(progress, step.id),
                "briefing_needed": needs_briefing(step, progress),
            }
            for step in steps
        ],
        "next_step": (
            {"step_id": nxt.id, "title": nxt.title, "area": nxt.area_title} if nxt else None
        ),
    }
