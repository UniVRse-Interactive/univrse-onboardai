"""Firestore access of the checklist agent: the same documents the OnboardAi
API uses (contract v1.3).

    onboardingTemplates/{track}     read
    onboardingProgress/{accountId}  read; one step written in a transaction:
        { accountId, updatedAt, steps: { [stepId]: { status, updatedAt,
          source: "alya-agent", actorId: accountId, briefedAt?, briefedBy? } } }
        The step's briefing fields (contract v1.5) are kept as they are.

Times are ISO 8601 UTC strings with milliseconds, like the API's. Nothing
here logs document data.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from . import rules

TEMPLATES = "onboardingTemplates"
PROGRESS = "onboardingProgress"
SOURCE = "alya-agent"


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _real_transaction(client: Any, work: Callable[[Any], Any]) -> Any:
    from google.cloud import firestore

    @firestore.transactional
    def run(transaction: Any) -> Any:
        return work(transaction)

    return run(client.transaction())


class ChecklistStore:
    def __init__(
        self,
        client: Any = None,
        *,
        project: str | None = None,
        database: str | None = None,
        run_transaction: Callable[[Any, Callable[[Any], Any]], Any] = _real_transaction,
        now: Callable[[], str] = iso_now,
    ) -> None:
        self._client = client
        self._project = project
        self._database = database
        self._run_transaction = run_transaction
        self._now = now

    def client(self) -> Any:
        if self._client is None:
            from google.cloud import firestore

            self._client = firestore.Client(project=self._project, database=self._database)
        return self._client

    def template(self, track: str) -> dict[str, Any] | None:
        snapshot = self.client().collection(TEMPLATES).document(track).get()
        return snapshot.to_dict() if snapshot.exists else None

    def progress(self, account_id: str) -> dict[str, Any] | None:
        snapshot = self.client().collection(PROGRESS).document(account_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def mark(
        self,
        account_id: str,
        step_id: str,
        new_status: str,
        *,
        require_briefing: bool = False,
    ) -> tuple[str, dict[str, Any]]:
        """Sets one step to new_status ("done" or "submitted") in a transaction.

        Returns (outcome, progress): "marked", or "already_done" /
        "already_submitted" when the step is there already, or
        "briefing_required" when require_briefing is set and the step's record
        has no briefedAt (nothing is written then; a submitted step is never
        moved back from done).
        """
        if new_status not in (rules.DONE, rules.SUBMITTED):
            raise ValueError("new_status must be done or submitted")
        ref = self.client().collection(PROGRESS).document(account_id)

        def work(transaction: Any) -> tuple[str, dict[str, Any]]:
            snapshot = ref.get(transaction=transaction)
            current = snapshot.to_dict() if snapshot.exists else {}
            status = rules.status_of(current, step_id)
            if status == rules.DONE:
                return "already_done", current
            if status == new_status:
                return "already_submitted", current
            if require_briefing and not rules.briefed(current, step_id):
                return "briefing_required", current
            at = self._now()
            steps = dict(current.get("steps") or {})
            record = rules.record_of(current, step_id)
            briefing = (
                {"briefedAt": record["briefedAt"], "briefedBy": record.get("briefedBy")}
                if rules.briefed(current, step_id)
                else {}
            )
            steps[step_id] = {
                "status": new_status,
                "updatedAt": at,
                "source": SOURCE,
                "actorId": account_id,
                **briefing,
            }
            updated = {"accountId": account_id, "updatedAt": at, "steps": steps}
            transaction.set(ref, updated)
            return "marked", updated

        return self._run_transaction(self.client(), work)
