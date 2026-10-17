import { ChatError } from './chat-errors.mjs';
import {
  ALIGNMENT_ACTIVITIES,
  APPROVED_HANDBOOK_METADATA,
  CONTENT_REQUIREMENTS,
  TOOL_ACCESS_STEP_IDS,
  alignmentPassingScore,
  gradeQuestions,
  policyPassingScore,
  publicVerificationContent,
  routingQuestions,
} from './task-verification.mjs';
import { createVerificationContentSource } from './verification-content.mjs';

// Verification routes of the four learning areas (Documentation is untouched).
//
//   me:  GET  /api/me/company-policy-handbook   content without answer keys
//        GET  /api/me/task-verifications        saved records + config
//        POST /api/me/task-verifications/:area/:activity
//   hr:  POST /api/hr/employees/:id/task-verifications/tool-access/:stepId
//        (the authorised confirmation of a tool-access request)
//
// Every record kind is stored apart: acknowledgements, quiz attempts, activity
// attempts, checklist acknowledgements, tool-access requests and confirmations.

// Alignment: four activities (matching and questions). Each pass completes its
// own onboarding step; every attempt is recorded either way.
const alignmentChecks = {
  'products-customers': {
    stepId: 'alignment.products-customers',
    activity: ALIGNMENT_ACTIVITIES.products,
  },
  'mission-values': { stepId: 'alignment.mission-values', activity: ALIGNMENT_ACTIVITIES.values },
  'org-structure': { stepId: 'alignment.org-structure', activity: ALIGNMENT_ACTIVITIES.teams },
  'role-contribution': {
    stepId: 'alignment.role-contribution',
    activity: ALIGNMENT_ACTIVITIES.roleContribution,
  },
};

// The record kept for every graded activity. The score can only be set here, from
// the server's own answer key; the browser never sends a score.
const attemptRecord = (previous = {}, { score, passingScore, passed, answers, at }) => ({
  ...previous,
  attempts: (previous.attempts || 0) + 1,
  score: Math.max(previous.score ?? 0, score),
  lastScore: score,
  passingScore,
  passed: Boolean(previous.passed || passed),
  lastAttemptAt: at,
  ...(passed && !previous.passedAt ? { passedAt: at } : {}),
  history: [...(previous.history || []), { at, score, passed }].slice(-20),
  lastAnswers: answers,
});

const MAX_ANSWER_BYTES = 20000;
const cleanAnswers = (value) => {
  const answers = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (JSON.stringify(answers).length > MAX_ANSWER_BYTES)
    throw new ChatError(400, 'ANSWERS_TOO_LARGE', 'Those answers are too large to save.');
  return answers;
};

const text = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

export function mountTaskVerificationRoutes({
  me,
  hr,
  employee,
  hrOnly,
  journey,
  store,
  contentSource = createVerificationContentSource(),
}) {
  const account = (req) => req.accountSession.account;

  // Grades one submission, records the attempt, clears the saved draft and, on a
  // pass, completes the task. `place` says where the record lives.
  const submitQuiz = async ({ acc, draftKey, questions, answers, passingScore, place, stepId }) => {
    const { results, score } = gradeQuestions(questions, answers);
    const passed = score >= passingScore;
    const at = new Date().toISOString();
    let attempts = 0;
    const saved = await store.saveVerification(acc.id, (v) => {
      const record = attemptRecord(place.get(v), { score, passingScore, passed, answers, at });
      place.set(v, record);
      attempts = record.attempts;
      if (v.drafts) delete v.drafts[draftKey];
      return v;
    });
    const onboarding = passed && stepId ? await journey.verifyStep(acc, stepId) : null;
    return {
      correct: passed,
      passed,
      score,
      passingScore,
      attempts,
      questionResults: results,
      feedback: passed
        ? `Passed with ${score}% (required: ${passingScore}%).`
        : `Score ${score}%. The pass mark is ${passingScore}%. Read the notes on the missed questions and try again.`,
      verifications: saved.verifications,
      ...(onboarding ? { onboarding } : {}),
    };
  };

  me.get('/company-policy-handbook', employee, async (_req, res) => {
    res.json({
      metadata: APPROVED_HANDBOOK_METADATA,
      ...publicVerificationContent(contentSource()),
      toolAccessSteps: TOOL_ACCESS_STEP_IDS,
      contentRequirements: CONTENT_REQUIREMENTS,
    });
  });

  me.get('/task-verifications', employee, async (req, res) => {
    res.json(await store.getVerifications(account(req).id));
  });

  me.post('/task-verifications/:areaId/:activityId', employee, async (req, res) => {
    const acc = account(req);
    const { areaId, activityId } = req.params;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    // Answers in progress are saved so an employee can leave and come back.
    if (body.action === 'draft') {
      const content = contentSource();
      const known =
        (areaId === 'policies' && content.policies[activityId]?.quiz) ||
        (areaId === 'alignment' && alignmentChecks[activityId]) ||
        (areaId === 'team-support' && activityId === 'support-routing');
      if (!known)
        throw new ChatError(404, 'ACTIVITY_NOT_FOUND', 'Verification activity not found.');
      const answers = cleanAnswers(body.answers);
      const key = `${areaId}/${activityId}`;
      const saved = await store.saveVerification(acc.id, (v) => {
        v.drafts = v.drafts || {};
        v.drafts[key] = {
          answers,
          notes: text(body.notes, 600),
          savedAt: new Date().toISOString(),
        };
        return v;
      });
      return res.json({ saved: true, savedAt: saved.verifications.drafts[key].savedAt });
    }

    if (areaId === 'policies') {
      const content = contentSource();
      const policy = content.policies[activityId];
      if (!policy) throw new ChatError(404, 'POLICY_NOT_FOUND', 'Policy topic not found.');

      if (body.action === 'acknowledge') {
        const at = new Date().toISOString();
        const saved = await store.saveVerification(acc.id, (v) => {
          v.policies = v.policies || {};
          const existing = v.policies[activityId] || {};
          v.policies[activityId] = {
            ...existing,
            acknowledgedAt: existing.acknowledgedAt || at,
          };
          return v;
        });
        // The acknowledgement records the briefing. It completes the step only
        // when the policy has no approved quiz; otherwise the quiz must be passed.
        const briefed = await journey.recordBriefing(acc, activityId, { completion: 'read' });
        const onboarding = policy.quiz ? briefed : await journey.verifyStep(acc, activityId);
        return res.json({
          acknowledged: true,
          acknowledgedAt: saved.verifications.policies[activityId].acknowledgedAt,
          verifications: saved.verifications,
          onboarding,
          message: 'Reading acknowledgement recorded.',
        });
      }

      if (body.action === 'quiz') {
        if (!policy.quiz)
          throw new ChatError(
            409,
            'NO_QUIZ',
            'This policy has no quiz; acknowledging it completes it.',
          );
        const current = await store.getVerifications(acc.id);
        if (!current.verifications.policies?.[activityId]?.acknowledgedAt)
          throw new ChatError(
            409,
            'ACKNOWLEDGEMENT_REQUIRED',
            'Acknowledge that you have read the policy before taking the check.',
          );
        return res.json(
          await submitQuiz({
            acc,
            draftKey: `policies/${activityId}`,
            questions: policy.quiz.questions,
            answers: cleanAnswers(body.answers),
            passingScore: policyPassingScore(),
            stepId: activityId,
            place: {
              get: (v) => v.policies?.[activityId]?.quiz,
              set: (v, record) => {
                v.policies = v.policies || {};
                v.policies[activityId] = { ...(v.policies[activityId] || {}), quiz: record };
              },
            },
          }),
        );
      }
      throw new ChatError(400, 'INVALID_POLICY_ACTION', 'Action must be acknowledge or quiz.');
    }

    if (areaId === 'alignment') {
      const check = alignmentChecks[activityId];
      if (check) {
        const notes = activityId === 'role-contribution' ? text(body.notes, 600) : '';
        return res.json(
          await submitQuiz({
            acc,
            draftKey: `alignment/${activityId}`,
            questions: check.activity.questions,
            answers: cleanAnswers(body.answers),
            passingScore: alignmentPassingScore(),
            stepId: check.stepId,
            place: {
              get: (v) => v.alignment?.[activityId],
              set: (v, record) => {
                v.alignment = v.alignment || {};
                v.alignment[activityId] = {
                  ...record,
                  ...(notes
                    ? { notes }
                    : v.alignment[activityId]?.notes
                      ? { notes: v.alignment[activityId].notes }
                      : {}),
                };
              },
            },
          }),
        );
      }
    }

    if (areaId === 'role-tools') {
      if (activityId === 'responsibilities') {
        const checked = Array.isArray(body.checkedItems) ? body.checkedItems.map(String) : [];
        const { byDepartment, default: fallback } = contentSource().responsibilities;
        const dept = text(body.department, 80);
        const items = byDepartment[dept] || fallback;
        if (!items.every((_, i) => checked.includes(String(i))))
          throw new ChatError(400, 'CHECKLIST_INCOMPLETE', 'Tick every item to acknowledge it.');
        const at = new Date().toISOString();
        const saved = await store.saveVerification(acc.id, (v) => {
          v.roleTools = v.roleTools || {};
          v.roleTools.responsibilities = {
            department: dept,
            acknowledgedAt: at,
            itemCount: items.length,
          };
          return v;
        });
        return res.json({
          success: true,
          feedback: 'Saved. This is an acknowledgement, not an assessment.',
          verifications: saved.verifications,
        });
      }

      if (activityId === 'tool-access') {
        const stepId = body.toolId;
        if (!TOOL_ACCESS_STEP_IDS.includes(stepId))
          throw new ChatError(
            400,
            'TOOL_NOT_FOUND',
            'This step does not use an access confirmation.',
          );
        const workEmail = text(body.workEmail, 254);
        if (!/^\S+@\S+\.\S+$/.test(workEmail))
          throw new ChatError(
            400,
            'INVALID_EMAIL',
            'Enter the work or Google account you use for this tool.',
          );
        const at = new Date().toISOString();
        let created = false;
        const saved = await store.saveVerification(acc.id, (v) => {
          v.roleTools = v.roleTools || {};
          v.roleTools.tools = v.roleTools.tools || {};
          const existing = v.roleTools.tools[stepId];
          if (existing?.status === 'confirmed') return v;
          created = true;
          v.roleTools.tools[stepId] = {
            workEmail,
            status: 'awaiting_confirmation',
            requestedAt: at,
          };
          return v;
        });
        return res.json({
          success: true,
          created,
          workflowStatus: saved.verifications.roleTools.tools[stepId].status,
          systemNotice:
            'No automatic directory check is connected to this deployment, so your onboarding coordinator confirms your access. The task completes once they do.',
          verifications: saved.verifications,
        });
      }
    }

    if (areaId === 'team-support') {
      if (activityId === 'support-routing') {
        return res.json(
          await submitQuiz({
            acc,
            draftKey: 'team-support/support-routing',
            questions: routingQuestions(contentSource().supportRouting),
            answers: cleanAnswers(body.answers),
            passingScore: alignmentPassingScore(),
            stepId: null,
            place: {
              get: (v) => v.teamSupport?.routing,
              set: (v, record) => {
                v.teamSupport = v.teamSupport || {};
                v.teamSupport.routing = record;
              },
            },
          }),
        );
      }

      // Optional and private: never required, never part of progress, and not
      // returned by the HR routes. An empty text removes it.
      if (activityId === 'working-preferences') {
        const value = text(body.text, 600);
        const saved = await store.saveVerification(acc.id, (v) => {
          v.teamSupport = v.teamSupport || {};
          if (value)
            v.teamSupport.workingPreferences = { text: value, savedAt: new Date().toISOString() };
          else delete v.teamSupport.workingPreferences;
          return v;
        });
        return res.json({ success: true, verifications: saved.verifications });
      }

      if (activityId === 'confirm-help') {
        const at = new Date().toISOString();
        const saved = await store.saveVerification(acc.id, (v) => {
          v.teamSupport = v.teamSupport || {};
          v.teamSupport.confirmedHelpAt = v.teamSupport.confirmedHelpAt || at;
          return v;
        });
        return res.json({
          success: true,
          confirmedHelpAt: saved.verifications.teamSupport.confirmedHelpAt,
          feedback: 'Saved. You can come back to this page whenever you need to find help.',
          verifications: saved.verifications,
        });
      }
    }

    throw new ChatError(404, 'ACTIVITY_NOT_FOUND', 'Verification activity not found.');
  });

  // The authorised coordinator confirms a pending tool-access request. Only this
  // completes an access step; the employee's request alone never does.
  hr.post('/employees/:id/task-verifications/tool-access/:stepId', hrOnly, async (req, res) => {
    const { id, stepId } = req.params;
    if (!TOOL_ACCESS_STEP_IDS.includes(stepId))
      throw new ChatError(400, 'TOOL_NOT_FOUND', 'This step does not use an access confirmation.');
    const current = await store.getVerifications(id);
    const request = current.verifications.roleTools?.tools?.[stepId];
    if (!request)
      throw new ChatError(409, 'NO_ACCESS_REQUEST', 'The employee has not requested confirmation.');
    const onboarding = await journey.verifyEmployeeStep(req.accountSession, id, stepId);
    const at = new Date().toISOString();
    await store.saveVerification(id, (v) => {
      v.roleTools.tools[stepId] = {
        ...v.roleTools.tools[stepId],
        status: 'confirmed',
        confirmedAt: at,
        confirmedBy: req.accountSession.account.id,
      };
      return v;
    });
    res.json({ confirmed: true, onboarding });
  });

  // Pending access requests of one employee, for the coordinator.
  hr.get('/employees/:id/task-verifications', hrOnly, async (req, res) => {
    const saved = await store.getVerifications(req.params.id);
    // Working preferences, drafts and raw answers are the employee's own; HR sees outcomes only.
    const { drafts: _drafts, ...rest } = saved.verifications;
    const strip = (record) => {
      if (!record || typeof record !== 'object') return record;
      const { lastAnswers: _answers, ...kept } = record;
      return kept;
    };
    const verifications = { ...rest };
    if (verifications.policies)
      verifications.policies = Object.fromEntries(
        Object.entries(verifications.policies).map(([id, p]) => [
          id,
          { ...p, quiz: strip(p.quiz) },
        ]),
      );
    if (verifications.alignment)
      verifications.alignment = Object.fromEntries(
        Object.entries(verifications.alignment).map(([id, a]) => [id, strip(a)]),
      );
    if (verifications.teamSupport) {
      const { workingPreferences: _private, routing, ...others } = verifications.teamSupport;
      verifications.teamSupport = { ...others, ...(routing ? { routing: strip(routing) } : {}) };
    }
    saved.verifications = verifications;
    res.json(saved);
  });
}
