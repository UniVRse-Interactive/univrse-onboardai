import { spokenText } from './speech-text-and-mouth-timing.js';
import { clothingPresentation } from './clothing-presentation.mjs';
import { answerReply } from './chat-answer-presentation.mjs';

const topics = [
  {
    kind: 'leave',
    label: 'Leave guidance',
    match: /\b(leave|time off|holidays?|vacation|absence|sick|annual entitlement)\b/i,
  },
  {
    kind: 'time',
    label: 'Hours & schedule',
    match:
      /\b(working hours|office hours|workweek|work schedule|hours of work|lunch|breaks?|shift|overtime)\b/i,
  },
  {
    kind: 'arrival',
    label: 'Arrival & check-in',
    match:
      /\b(reception|front desk|arriv\w*|report to|entrance|office location|parking|commute|check.in)\b/i,
  },
  {
    kind: 'computer',
    label: 'Tools & access',
    match:
      /\b(laptop|computer|software|email|apps?|accounts?|employee portal|log.?in|sign.?in|password|IT support|IT team|IT department|access)\b/i,
  },
  {
    kind: 'security',
    label: 'Safety & security',
    match: /\b(safety|security|emergency|fire|evacuat\w*|confidential|phishing|protect|privacy)\b/i,
  },
  {
    kind: 'payroll',
    label: 'Pay & benefits',
    match:
      /\b(payroll|salary|salaries|payday|payslip|benefits?|insurance|reimburse\w*|claims?|receipts?|expenses?)\b/i,
  },
  {
    kind: 'approval',
    label: 'Approval & conditions',
    match: /\b(approval|approv\w*|permission|authori[sz]\w*)\b/i,
  },
  {
    kind: 'document',
    label: 'Documents & forms',
    match:
      /\b(documents?|forms?|handbook|identification|ID|contract|receipts?|policy|policies|guide)\b/i,
  },
  {
    kind: 'meeting',
    label: 'Meetings & orientation',
    match: /\b(meetings?|orientation|induction|agenda|training|workshop|briefing)\b/i,
  },
  {
    kind: 'people',
    label: 'People & support',
    match: /\b(HR|human resources|manager|team|colleagues?|mentor|buddy|contact|ask|meet)\b/i,
  },
  {
    kind: 'tasks',
    label: 'Your next steps',
    match:
      /\b(first.day|first.week|onboarding|checklist|tasks?|quiz|course|prepare|bring|read|complete|submit|review|finish)\b/i,
  },
  {
    kind: 'company',
    label: 'Your company',
    match:
      /\b(company|organisation|organization|mission|values|culture|virtual reality|augmented reality|metaverse)\b/i,
  },
  {
    kind: 'conversation',
    label: 'Let’s talk it through',
    match: /\b(hello|welcome|thank|questions?|explain|discuss)\b/i,
  },
];

export function presentationSceneAt(presentation, character) {
  if (!presentation || !Number.isFinite(character)) return -1;
  return presentation.scenes.findIndex(
    (scene) => scene.visible && character >= scene.start && character < scene.end,
  );
}

export function answerPresentation(message, reply = answerReply(message)) {
  if (!reply?.trim()) return null;
  const clothing = clothingPresentation(message, reply);
  if (clothing)
    return {
      ...clothing,
      kind: 'clothing',
      scenes: clothing.scenes.map((scene) => ({ ...scene, visible: scene.garments.length > 0 })),
    };
  const text = spokenText(reply);
  if (!text) return null;
  const scenes = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(
    ({ segment, index }) => {
      const body = segment.trim();
      const times = [
        ...new Set(
          body.match(
            /\b\d{1,2}(?:[.:]\d{2})?\s*(?:[ap]\.m\.?|[ap]m)(?![a-z])|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gi,
          ) || [],
        ),
      ];
      const unknown =
        /\b(cannot confirm|can['’]t confirm|do not have|don['’]t have|couldn['’]t find|no matching|not (?:yet )?(?:available|confirmed|specified)|check with HR)\b/i.test(
          body,
        );
      let matches = topics.filter((topic) => topic.match.test(body));
      // "Leave the office at 5pm" describes departure, not annual leave.
      if (
        /\bleave (?:at\s+\d|(?:the |your )?(?:office|building|workplace|premises|desk))\b/i.test(
          body,
        )
      )
        matches = matches.filter((topic) => topic.kind !== 'leave');
      // A literal time leads the scene only when the sentence is about time:
      // the hours/schedule words matched, or nothing else did. Otherwise the
      // sentence keeps its own subject first (IT setup "at 09:45" is about IT)
      // and the time is shown beside it.
      // "From lunch on day 1" mentions a meal in passing: with no literal time and
      // another subject, the clock (which would show "?") is left out.
      if (
        !times.length &&
        matches.length > 1 &&
        !/\b(working hours|office hours|workweek|work schedule|hours of work|shift|overtime)\b/i.test(
          body,
        )
      )
        matches = matches.filter((topic) => topic.kind !== 'time');
      if (times.length && !matches.some((topic) => topic.kind === 'time')) {
        const time = topics.find((topic) => topic.kind === 'time');
        if (matches.length) matches.splice(1, 0, time);
        else matches = [time];
      }
      if (unknown)
        matches = topics.filter(
          (topic) => ['document', 'people'].includes(topic.kind) && topic.match.test(body),
        );
      if (!matches.length)
        matches = [{ kind: 'document', label: unknown ? 'Check company guidance' : 'Your answer' }];
      const condition =
        /\b(only|unless|except|approval|approve\w*|must|required|subject to|depends|depending|not allowed|before|after)\b/i.test(
          body,
        );
      const first = matches[0];
      const visuals =
        first.kind === 'time' && times.length && !unknown
          ? times.slice(0, 4).reduce((groups, time, i) => {
              // Display only literal time values. A separator must not invent
              // a time range or chronological relationship between facts.
              if (times.length > 2 && i % 2) groups.at(-1).label += ' · ' + time;
              else groups.push({ kind: 'time', label: time, times: [time] });
              return groups;
            }, [])
          : matches.slice(0, 2).map((topic) => ({
              kind: topic.kind,
              // A clock beside another subject is captioned with its literal time.
              label:
                topic.kind === 'time' && times.length ? times.slice(0, 2).join(' · ') : topic.label,
              times: topic.kind === 'time' ? times : [],
            }));
      return {
        start: index,
        end: index + segment.length,
        body,
        visible: true,
        label: unknown ? 'Check company guidance' : first.label,
        eyebrow: unknown
          ? 'CONFIRM WITH YOUR COMPANY'
          : condition
            ? 'DETAILS & CONDITIONS'
            : 'YOUR ONBOARDING, EXPLAINED',
        condition,
        visuals,
      };
    },
  );
  return { kind: 'onboarding', text, scenes };
}
