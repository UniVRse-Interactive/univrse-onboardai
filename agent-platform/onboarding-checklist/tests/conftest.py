"""Test settings: a synthetic environment and an in-memory Firestore, so the
tests need no .env, network, credentials, Firestore or Gemini."""

import copy
import os
import sys
from pathlib import Path

TEST_ENV = {
    "GOOGLE_GENAI_USE_VERTEXAI": "TRUE",
    "GOOGLE_CLOUD_PROJECT": "synthetic-test-project",
    "GOOGLE_CLOUD_LOCATION": "global",
    "CHECKLIST_AGENT_MODEL": "gemini-test-model",
    "FIRESTORE_PROJECT_ID": "demo-synthetic",
    "FIRESTORE_DATABASE_ID": "(default)",
}
for name in ("CHECKLIST_GEMINI_PROJECT", "CHECKLIST_GEMINI_LOCATION", "FIRESTORE_EMULATOR_HOST"):
    os.environ.pop(name, None)
os.environ.update(TEST_ENV)
AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

ACCOUNT = "0d6f1c2e-1111-4222-8333-444455556666"
OTHER = "9a9a9a9a-1111-4222-8333-444455556666"
NOW = "2026-10-16T09:30:00.000Z"
BRIEFED_AT = "2026-10-16T09:00:00.000Z"


def step(step_id, title, completion, required=True):
    # Every required step has Alya's briefing (contract v1.5); optional ones none.
    return {
        "id": step_id,
        "title": title,
        "description": "",
        "required": required,
        "completion": completion,
        "askAlya": f"About {title}?",
        "briefing": (
            {"text": f"Alya's briefing for {title}. It is synthetic.", "sourceTitle": None}
            if required
            else None
        ),
    }


def briefed(*step_ids, account=ACCOUNT):
    """The progress document of an employee who had these steps' briefings."""
    return {
        f"onboardingProgress/{account}": {
            "accountId": account,
            "updatedAt": BRIEFED_AT,
            "steps": {
                step_id: {"briefedAt": BRIEFED_AT, "briefedBy": "listened"} for step_id in step_ids
            },
        }
    }


def area(area_id, title, steps):
    return {"id": area_id, "icon": "", "title": title, "description": "", "steps": steps}


# A synthetic template with the shape of the seeded ones: five areas of four
# required steps, one optional step, and every completion type.
TEMPLATE = {
    "track": "employee",
    "version": 2,
    "threshold": 70,
    "areas": [
        area(
            "documentation",
            "Documentation",
            [
                step("documentation.contract", "Sign your employment contract", "hr_verify"),
                step("documentation.personal-bank-details", "Submit your personal and bank details", "hr_verify"),
                step("documentation.tax-id-documents", "Show your tax and ID documents", "hr_verify"),
                step("documentation.emergency-contact", "Submit your emergency contact form", "hr_verify"),
            ],
        ),
        area(
            "policies",
            "Policies & Safe Practices",
            [
                step("policies.employee-handbook", "Company rules (Employee Handbook)", "check"),
                step("policies.workplace-conduct", "Workplace conduct & safe practices", "check"),
                step("policies.data-protection", "Privacy & data handling (PDPA)", "check"),
                step("policies.responsible-ai", "Responsible AI use", "check"),
            ],
        ),
        area(
            "alignment",
            "Company Purpose & Alignment",
            [
                step("alignment.products-customers", "What the company does", "self"),
                step("alignment.mission-values", "Mission, values and goals", "self"),
                step("alignment.org-structure", "How teams fit together", "self"),
                step("alignment.role-contribution", "How your role contributes", "self"),
            ],
        ),
        area(
            "role-tools",
            "Role, Tools & AI Readiness",
            [
                step("role-tools.laptop-accounts", "Set up your laptop and accounts", "self"),
                step("role-tools.work-tools", "Email, chat and work tools access", "self"),
                step("role-tools.role-responsibilities", "Agree your responsibilities with your manager", "hr_verify"),
                step("role-tools.ai-training", "Identify suitable AI training", "self"),
            ],
        ),
        area(
            "team-support",
            "People & Workplace Support",
            [
                step("team-support.meet-manager", "Meet your manager", "self"),
                step("team-support.meet-teammates", "Meet your teammates", "self"),
                step("team-support.meet-buddy", "Meet your buddy", "self"),
                step("team-support.help-contacts", "Know who to ask for help", "self"),
                step(
                    "team-support.working-preferences",
                    "Share your working preferences or support needs (optional)",
                    "self",
                    required=False,
                ),
            ],
        ),
    ],
}


class FakeSnapshot:
    def __init__(self, data):
        self._data = copy.deepcopy(data)
        self.exists = data is not None

    def to_dict(self):
        return copy.deepcopy(self._data) if self.exists else None


class FakeDocument:
    def __init__(self, db, path):
        self._db = db
        self.path = path

    def get(self, transaction=None):
        self._db.reads.append((self.path, transaction))
        return FakeSnapshot(self._db.documents.get(self.path))


class FakeCollection:
    def __init__(self, db, name):
        self._db = db
        self._name = name

    def document(self, doc_id):
        return FakeDocument(self._db, f"{self._name}/{doc_id}")


class FakeTransaction:
    def __init__(self, db):
        self._db = db
        self.writes = []

    def set(self, ref, data):
        self.writes.append((ref.path, copy.deepcopy(data)))


class FakeFirestore:
    """The part of google.cloud.firestore.Client the store uses."""

    def __init__(self, documents=None):
        self.documents = copy.deepcopy(documents or {})
        self.reads = []
        self.transactions = []

    def collection(self, name):
        return FakeCollection(self, name)

    def transaction(self):
        return FakeTransaction(self)


def fake_run_transaction(client, work):
    """Runs work like firestore.transactional: the writes apply on commit."""
    transaction = client.transaction()
    result = work(transaction)
    client.transactions.append(transaction)
    for path, data in transaction.writes:
        client.documents[path] = data
    return result


def make_store(documents=None):
    from onboarding_checklist.store import ChecklistStore

    db = FakeFirestore(
        {"onboardingTemplates/employee": TEMPLATE, **(documents or {})},
    )
    return db, ChecklistStore(db, run_transaction=fake_run_transaction, now=lambda: NOW)
