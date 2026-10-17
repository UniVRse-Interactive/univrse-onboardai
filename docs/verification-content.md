# Verification content

The four learning areas (Policies, Company Purpose, Role & Tools, People & Support)
verify tasks with acknowledgements, quizzes, matching, scenarios and confirmations.
Built-in content in `server/task-verification.mjs` only restates the onboarding plan
(`server/onboarding-content.mjs`). To add approved material, point
`VERIFICATION_CONTENT_FILE` at a JSON file. The file is re-read when it changes; each
invalid part is ignored with a warning in the server log.

```json
{
  "policies": {
    "policies.data-protection": {
      "title": "Privacy & data handling",
      "sourceTitle": "UniVRse - Employee Handbook",
      "document": { "title": "Data Protection Policy", "url": "https://…" },
      "quiz": {
        "questions": [
          {
            "id": "q1",
            "prompt": "…",
            "options": [
              { "id": "a", "text": "…" },
              { "id": "b", "text": "…" }
            ],
            "correct": ["a"],
            "explanation": "…"
          }
        ]
      }
    }
  },
  "supportContacts": [{ "name": "…", "email": "name@company.com", "purpose": "…" }],
  "supportRouting": [
    {
      "id": "s1",
      "situation": "…",
      "options": [
        { "id": "a", "label": "…" },
        { "id": "b", "label": "…" }
      ],
      "correctId": "a",
      "explanation": "…"
    }
  ],
  "responsibilities": {
    "default": ["…"],
    "byDepartment": { "Finance": ["…"] }
  }
}
```

- Policy keys must be existing `policies.*` step ids. Without `quiz`, acknowledging the
  policy completes the task. With several ids in `correct`, the question is multi-select.
- `document.url` must be `https`.
- Pass marks: `POLICY_QUIZ_PASSING_SCORE`, `ALIGNMENT_CHECK_PASSING_SCORE` (1-100, default 100).

## Still needed from the company

Full handbook and policy documents with links; approved quiz questions beyond the
handbook summaries; role responsibilities per department; a contact directory; an
integration or coordinator process to verify Google Workspace access. The Company
Purpose activities are defined in code and are built from the onboarding plan's briefings.

## How access is verified

No directory integration exists. An employee requests confirmation for each access step
(GSheet, Drive, Gmail/Chat, work email); the task shows "Awaiting verification" until an
HR user confirms it from the employee's onboarding panel ("Confirm access"). Other setup
tasks are shown as "Employee-confirmed".
