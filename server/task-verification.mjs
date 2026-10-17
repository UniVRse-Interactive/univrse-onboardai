import { ChatError } from './chat-errors.mjs';
import { journeyCollections } from './onboarding-collections.mjs';
import { handbookTitle } from './onboarding-content.mjs';

// Task verification content and storage for the four learning areas.
//
// Every fact below is taken from the approved onboarding plan
// (server/onboarding-content.mjs: its briefings and knowledge checks). Nothing
// here may add a policy, contact, date or tool state that the plan does not
// state. Content that is missing is named in `contentRequirements` instead.
// The quiz questions only ask what the matching briefing says; if HR edits a
// briefing, review the questions for that step.

export const DEFAULT_POLICY_PASSING_SCORE = 100;

const passingScoreFrom = (name, env) => {
  const value = Number.parseInt(env[name] ?? '', 10);
  return Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_POLICY_PASSING_SCORE;
};
// Pass marks are server configuration, read per request; a client can never
// lower them. POLICY_QUIZ_PASSING_SCORE for policy quizzes and
// ALIGNMENT_CHECK_PASSING_SCORE for alignment knowledge checks (1-100).
export const policyPassingScore = (env = process.env) =>
  passingScoreFrom('POLICY_QUIZ_PASSING_SCORE', env);
export const alignmentPassingScore = (env = process.env) =>
  passingScoreFrom('ALIGNMENT_CHECK_PASSING_SCORE', env);

// Role/tool steps whose completion means "I was given access". They are proven
// by an authorised coordinator confirmation, never by a checkbox.
export const TOOL_ACCESS_STEP_IDS = Object.freeze([
  'role-tools.gsheet-account',
  'role-tools.individual-gsheet',
  'role-tools.drive-shared-folders',
  'role-tools.gmail-google-chat',
  'role-tools.professional-email',
]);

export const APPROVED_HANDBOOK_METADATA = Object.freeze({
  title: handbookTitle,
  publisher: 'UniVRse',
  contentRequirementNotice:
    'Content requirement: the full Employee Handbook document has not been added to this deployment. The summaries shown come from your onboarding plan. HR should add the full handbook so employees can read the source document.',
});

// Missing content, shown to HR/employees instead of being invented.
export const CONTENT_REQUIREMENTS = Object.freeze([
  'Full Employee Handbook document and any separate privacy, data protection and responsible AI policy documents.',
  'Role-specific responsibilities and first-30-day goals for each role (the profile only holds title, department and manager).',
  'A directory of team contacts and support channels beyond IT (it-help@univrse.example) and the contacts HR enters for the first day.',
  'An integration or coordinator workflow to verify Google Workspace tool access automatically.',
]);

// Question builders. Types: single (one right option), multi (several right
// options, all required) and match (pair every statement with its choice).
const q = (id, prompt, options, correct, explanation, multiple = false) => ({
  id,
  type: multiple || (Array.isArray(correct) && correct.length > 1) ? 'multi' : 'single',
  prompt,
  multiple: multiple || (Array.isArray(correct) && correct.length > 1),
  options: options.map(([oid, text]) => ({ id: oid, text })),
  correct: Array.isArray(correct) ? correct : [correct],
  explanation,
});
const match = (id, prompt, pairs, choices, explanation) => ({
  id,
  type: 'match',
  prompt,
  pairs: pairs.map(([pid, text, correct]) => ({ id: pid, text, correct })),
  choices: choices.map(([cid, label]) => ({ id: cid, label })),
  explanation,
});

// Each question below is a situation answered by what the briefing for that
// step states; none relies on a rule the onboarding plan does not give.
export const APPROVED_POLICIES = Object.freeze({
  'policies.employee-handbook': {
    title: 'Company rules: working hours and dress code',
    sourceTitle: handbookTitle,
    objectives: [
      'Know what to wear Monday to Thursday and on casual Friday.',
      'Know what is never allowed, and who to ask when you are unsure.',
    ],
    quiz: {
      questions: [
        q(
          'q1',
          'It is a Friday and you have no client meetings or events. Which outfit fits the dress code?',
          [
            ['a', 'Denim shorts, a plain T-shirt and clean sneakers'],
            ['b', 'A gym tracksuit, a plain T-shirt and running shoes'],
            ['c', 'Long jeans, a plain T-shirt and clean sneakers'],
          ],
          'c',
          'On casual Friday, long jeans, plain T-shirts and clean sneakers are fine. Short pants of any kind are not allowed on any working day, and sportswear is only for company sports events.',
        ),
        q(
          'q2',
          'It is Tuesday. Which dress code applies?',
          [
            ['a', 'Casual Friday'],
            ['b', 'Smart casual'],
            ['c', 'Whatever is comfortable'],
          ],
          'b',
          'The dress code is smart casual from Monday to Thursday.',
        ),
        q(
          'q3',
          'It is Thursday and a colleague says you can wear your casual Friday outfit “because it is nearly Friday”. What is right?',
          [
            ['a', 'They are right; Thursday is part of the casual week'],
            [
              'b',
              'No. Smart casual applies Monday to Thursday; casual Friday outfits are for Friday',
            ],
            ['c', 'It is fine if you wear a jacket'],
          ],
          'b',
          'The dress code is smart casual from Monday to Thursday; the casual Friday allowance is for Friday.',
        ),
        q(
          'q4',
          'It is a hot Friday and you want to wear tailored shorts to the office. What is right?',
          [
            ['a', 'Fine, because it is casual Friday'],
            ['b', 'Fine if they are knee length'],
            ['c', 'Not allowed: short pants of any kind are not allowed on any working day'],
          ],
          'c',
          'Short pants of any kind are not allowed on any working day, including casual Friday.',
        ),
        q(
          'q5',
          'You exercised before work on a Wednesday and want to stay in your gym tracksuit all day. What is right?',
          [
            ['a', 'Not allowed: sportswear is only for company sports events'],
            ['b', 'Allowed if you change your shoes'],
            ['c', 'Allowed because you are not meeting anyone'],
          ],
          'a',
          'Sportswear is only for company sports events.',
        ),
        q(
          'q6',
          'The company is holding a sports event next week. May you wear sportswear to it?',
          [
            ['a', 'No, sportswear is never allowed'],
            ['b', 'Yes: sportswear is for company sports events'],
            ['c', 'Only if your manager is not attending'],
          ],
          'b',
          'Sportswear is only for company sports events, so it fits there.',
        ),
        q(
          'q7',
          'Which of these are fine on casual Friday? Select all that apply.',
          [
            ['a', 'Long jeans'],
            ['b', 'A plain T-shirt'],
            ['c', 'Clean sneakers'],
            ['d', 'Short pants'],
            ['e', 'A gym tracksuit'],
          ],
          ['a', 'b', 'c'],
          'Long jeans, plain T-shirts and clean sneakers are fine on casual Friday. Short pants and sportswear are not.',
        ),
        q(
          'q8',
          'You are not sure whether an outfit is acceptable. What should you do?',
          [
            ['a', 'Wear it and see if anyone mentions it'],
            ['b', 'Ask your manager or People and Culture first'],
            ['c', 'Ask IT'],
          ],
          'b',
          'If you are unsure about an outfit, ask your manager or People and Culture first.',
        ),
      ],
    },
  },
  'policies.workplace-conduct': {
    title: 'Workplace conduct & safe practices',
    sourceTitle: handbookTitle,
    objectives: [
      'Recognise behaviour that is not tolerated.',
      'Protect your password and respond correctly to suspicious emails and lost devices.',
    ],
    quiz: {
      questions: [
        q(
          'q1',
          'An email that says it is from IT asks you to reply with your password so your account can be “verified”. What should you do?',
          [
            ['a', 'Forward it to it-help@univrse.example without clicking its links'],
            ['b', 'Reply with your password so that IT can verify you'],
            ['c', 'Open the link in it to check that the request is real'],
          ],
          'a',
          'IT will never ask for your password. Forward suspicious emails to IT without clicking their links.',
        ),
        q(
          'q2',
          'Someone phones, says they are from IT, and asks for your password to fix a problem. What is right?',
          [
            ['a', 'Give it; they are from IT'],
            ['b', 'Do not share it: never share your password, not even with IT'],
            ['c', 'Give only half of it'],
          ],
          'b',
          'Never share your password, not even with IT, because IT will never ask for it.',
        ),
        q(
          'q3',
          'A colleague asks to borrow your password to finish an urgent report. What is right?',
          [
            ['a', 'Say no: never share your password'],
            ['b', 'Share it if they promise to change it'],
            ['c', 'Share it only for one hour'],
          ],
          'a',
          'Never share your password. IT will not ask for it, and neither should anyone else.',
        ),
        q(
          'q4',
          'An unexpected email with a link looks suspicious. What do you do?',
          [
            ['a', 'Click the link to check it'],
            ['b', 'Forward it to IT without clicking the link'],
            ['c', 'Reply to ask the sender if it is real'],
          ],
          'b',
          'Forward suspicious emails to IT without clicking their links.',
        ),
        q(
          'q5',
          'Your company laptop is stolen from your car at 9:00. By when must you report it to IT?',
          [
            ['a', 'Within 2 hours'],
            ['b', 'By the end of the week'],
            ['c', 'Only if it has not turned up after a few days'],
          ],
          'a',
          'Report a lost or stolen laptop to IT within 2 hours.',
        ),
        q(
          'q6',
          'You cannot find your laptop and want to search the house for a day before telling anyone. What is right?',
          [
            ['a', 'Search first; report only if you do not find it'],
            ['b', 'Report it to IT within 2 hours, even if you may still find it'],
            ['c', 'Tell a colleague and let them decide'],
          ],
          'b',
          'Report a lost or stolen laptop to IT within 2 hours.',
        ),
        q(
          'q7',
          'A teammate repeatedly humiliates another colleague in front of the team. What is the company position?',
          [
            ['a', 'It is acceptable if it is meant as a joke'],
            ['b', 'It is not tolerated: bullying, discrimination and harassment are not tolerated'],
            ['c', 'It is a private matter between them'],
          ],
          'b',
          'Treat colleagues, customers and partners with respect: bullying, discrimination and harassment are not tolerated.',
        ),
        q(
          'q8',
          'Which of these are not tolerated? Select all that apply.',
          [
            ['a', 'Bullying'],
            ['b', 'Discrimination'],
            ['c', 'Harassment'],
            ['d', 'Polite disagreement in a meeting'],
          ],
          ['a', 'b', 'c'],
          'Bullying, discrimination and harassment are not tolerated. Respectful disagreement is not any of these.',
        ),
        q(
          'q9',
          'Whom must you treat with respect? Select all that apply.',
          [
            ['a', 'Colleagues'],
            ['b', 'Customers'],
            ['c', 'Partners'],
            ['d', 'Only your manager'],
          ],
          ['a', 'b', 'c'],
          'Treat colleagues, customers and partners with respect.',
        ),
      ],
    },
  },
  'policies.data-protection': {
    title: 'Privacy & data handling (PDPA)',
    sourceTitle: handbookTitle,
    objectives: [
      'Know which information is confidential and for how long.',
      'Use customer data only for your job and keep it off personal devices and accounts.',
    ],
    quiz: {
      questions: [
        q(
          'q1',
          'A colleague asks you to copy a customer list to your personal Google Drive to work on it at home. What do you do?',
          [
            ['a', 'Decline and keep the list in company systems'],
            ['b', 'Copy it, then delete it on Monday'],
            ['c', 'Email it to your personal address just this once'],
          ],
          'a',
          'Never copy customer data to a personal device or a personal account.',
        ),
        q(
          'q2',
          'Which law does UniVRse follow when handling personal data?',
          [
            ['a', 'Malaysia’s Personal Data Protection Act 2010'],
            ['b', 'No specific law; only company rules'],
            ['c', 'Singapore’s tax law'],
          ],
          'a',
          'UniVRse handles personal data in line with Malaysia’s Personal Data Protection Act 2010.',
        ),
        q(
          'q3',
          'Which of these are confidential? Select all that apply.',
          [
            ['a', 'Customer data'],
            ['b', 'Prices'],
            ['c', 'Source code'],
            ['d', 'Business plans'],
            ['e', 'The company’s public opening hours'],
          ],
          ['a', 'b', 'c', 'd'],
          'Customer data, prices, source code and business plans are confidential.',
        ),
        q(
          'q4',
          'You are leaving UniVRse next month. May you keep a copy of the source code you wrote?',
          [
            ['a', 'Yes, you wrote it'],
            ['b', 'No: confidentiality applies during and after your employment'],
            ['c', 'Yes, if you tell your manager'],
          ],
          'b',
          'These things stay confidential during and after your employment.',
        ),
        q(
          'q5',
          'You are curious about a customer’s records that have nothing to do with your task. May you open them?',
          [
            ['a', 'Yes, you already have access'],
            ['b', 'No: use customer data only to do your job'],
            ['c', 'Yes, if you do not copy anything'],
          ],
          'b',
          'Use customer data only to do your job.',
        ),
        q(
          'q6',
          'You want to work from home on your personal laptop and download customer data to it. What is right?',
          [
            ['a', 'Fine if you delete it afterwards'],
            ['b', 'Not allowed: never copy customer data to a personal device'],
            ['c', 'Fine if the laptop has a password'],
          ],
          'b',
          'Never copy customer data to a personal device or a personal account.',
        ),
        q(
          'q7',
          'You want to read the price list on your phone and consider emailing it to your personal address. What is right?',
          [
            ['a', 'Fine, prices are not sensitive'],
            ['b', 'Not allowed: prices are confidential and must not go to a personal account'],
            ['c', 'Fine if you delete the email'],
          ],
          'b',
          'Prices are confidential, and confidential information must never be copied to a personal account.',
        ),
        q(
          'q8',
          'A friend asks you at dinner about UniVRse’s business plans. What do you do?',
          [
            ['a', 'Share general ideas'],
            ['b', 'Keep them confidential: business plans are confidential'],
            ['c', 'Share them if the friend promises to keep quiet'],
          ],
          'b',
          'Business plans are confidential during and after your employment.',
        ),
      ],
    },
  },
  'policies.responsible-ai': {
    title: 'Responsible AI use',
    sourceTitle: handbookTitle,
    objectives: [
      'Know which AI tools are approved.',
      'Know what must never be pasted into an unapproved tool, and who to ask first.',
    ],
    quiz: {
      questions: [
        q(
          'q1',
          'You want help debugging confidential UniVRse code and a friend suggests a free chatbot. What do you do?',
          [
            ['a', 'Use an AI tool IT has approved, such as Alya or Gemini in your UniVRse account'],
            ['b', 'Paste the code into the free chatbot without your name'],
            ['c', 'Put the code on a public page and ask the chatbot to read it'],
          ],
          'a',
          'Use only approved AI tools, and never paste source code into a tool IT has not approved.',
        ),
        q(
          'q2',
          'Which of these are approved AI tools? Select all that apply.',
          [
            ['a', 'Alya'],
            ['b', 'Gemini in your UniVRse account'],
            ['c', 'A free chatbot you found online'],
          ],
          ['a', 'b'],
          'Approved AI tools include Alya and Gemini in your UniVRse account.',
        ),
        q(
          'q3',
          'Which must never be pasted into an AI tool that IT has not approved? Select all that apply.',
          [
            ['a', 'Customer data'],
            ['b', 'Payslips'],
            ['c', 'Source code'],
            ['d', 'A public holiday date'],
          ],
          ['a', 'b', 'c'],
          'Never paste customer data, payslips or source code into an AI tool that IT has not approved.',
        ),
        q(
          'q4',
          'You found a new AI tool that summarises documents well. You think the team needs it. What do you do first?',
          [
            ['a', 'Start using it with real documents'],
            ['b', 'Ask IT first'],
            ['c', 'Use it on your personal phone'],
          ],
          'b',
          'If you think you need a different tool, ask IT first.',
        ),
        q(
          'q5',
          'You are asked to summarise a customer email thread and a tool IT has not approved would be quicker. What is right?',
          [
            ['a', 'Paste it in; it is only one thread'],
            ['b', 'Do not paste customer data into an unapproved tool'],
            ['c', 'Paste it in after removing the greeting'],
          ],
          'b',
          'Never paste customer data into an AI tool that IT has not approved.',
        ),
        q(
          'q6',
          'You need a table of payslip figures reformatted and an unapproved tool offers to do it. What is right?',
          [
            ['a', 'Fine, it is only formatting'],
            ['b', 'Not allowed: never paste payslips into an unapproved AI tool'],
            ['c', 'Fine if you hide the names'],
          ],
          'b',
          'Never paste payslips into an AI tool that IT has not approved.',
        ),
        q(
          'q7',
          'You want an AI tool to write a generic meeting agenda with no company data. Which choice is right?',
          [
            ['a', 'Use an approved tool such as Alya or Gemini in your UniVRse account'],
            ['b', 'Any public chatbot is fine if no data is involved'],
            ['c', 'Ask your friend to run it on their account'],
          ],
          'a',
          'Use only approved AI tools, such as Alya and Gemini in your UniVRse account.',
        ),
        q(
          'q8',
          'Your friend says Gemini is approved, so you may use it with your personal account. What is right?',
          [
            ['a', 'Any Gemini account is approved'],
            ['b', 'The approved tool is Gemini in your UniVRse account; use that'],
            ['c', 'Use personal accounts for sensitive work'],
          ],
          'b',
          'The approved tools are Alya and Gemini in your UniVRse account.',
        ),
      ],
    },
  },
});

// Area 2: Company Purpose & Alignment. Built only from the plan's summaries.
export const ALIGNMENT_ACTIVITIES = Object.freeze({
  products: {
    title: 'What the company does',
    instructions:
      'Show what you know about our products and customers, using your “What the company does” summary.',
    objectives: ['Know what UniVRse builds, for whom, and how its two products differ.'],
    questions: [
      match(
        'q1',
        'Match each description to the right item.',
        [
          ['p1', 'Bookings and scheduling', 'univrse-book'],
          ['p2', 'Payments', 'univrse-pay'],
          ['p3', 'Clinics, salons and wellness studios in Malaysia and Singapore', 'customers'],
        ],
        [
          ['univrse-book', 'UniVRse Book'],
          ['univrse-pay', 'UniVRse Pay'],
          ['customers', 'Our customers'],
        ],
        'UniVRse Book is for bookings and scheduling, UniVRse Pay is for payments, and our customers are clinics, salons and wellness studios in Malaysia and Singapore.',
      ),
      q(
        'q2',
        'What does UniVRse build?',
        [
          ['a', 'Booking and scheduling software'],
          ['b', 'Accounting software for large enterprises'],
          ['c', 'Hardware for clinics'],
        ],
        'a',
        'UniVRse builds booking and scheduling software for clinics, salons and wellness studios.',
      ),
      q(
        'q3',
        'In which countries are our customers?',
        [
          ['a', 'Malaysia and Singapore'],
          ['b', 'Malaysia only'],
          ['c', 'Singapore and Indonesia'],
        ],
        'a',
        'Our customers are in Malaysia and Singapore.',
      ),
      q(
        'q4',
        'A clinic owner wants patients to book appointments online. Which product fits?',
        [
          ['a', 'UniVRse Book'],
          ['b', 'UniVRse Pay'],
        ],
        'a',
        'UniVRse Book is for bookings and scheduling.',
      ),
      q(
        'q5',
        'A wellness studio wants to take payments from customers. Which product fits?',
        [
          ['a', 'UniVRse Book'],
          ['b', 'UniVRse Pay'],
        ],
        'b',
        'UniVRse Pay is for payments.',
      ),
      q(
        'q6',
        'About how many businesses use UniVRse today?',
        [
          ['a', 'About 240'],
          ['b', 'About 2,400'],
          ['c', 'About 24,000'],
        ],
        'b',
        'About 2,400 businesses use UniVRse today.',
      ),
      q(
        'q7',
        'Which of these are types of UniVRse customers? Select all that apply.',
        [
          ['a', 'Clinics'],
          ['b', 'Salons'],
          ['c', 'Wellness studios'],
          ['d', 'Airlines'],
        ],
        ['a', 'b', 'c'],
        'Our customers are clinics, salons and wellness studios.',
      ),
    ],
  },
  values: {
    title: 'Mission, values and goals',
    instructions:
      'Show what you know about the mission and values, using your “Mission, values and goals” summary.',
    objectives: [
      'Know the mission and the four values, and where this year’s goals are presented.',
    ],
    questions: [
      q(
        'q1',
        'What is the company’s mission?',
        [
          [
            'a',
            'To help small service businesses spend less time on admin and more time with their customers',
          ],
          ['b', 'To be the largest software company in Southeast Asia'],
          ['c', 'To replace front-desk staff with software'],
        ],
        'a',
        'Our mission is to help small service businesses spend less time on admin and more time with their customers.',
      ),
      q(
        'q2',
        'Which are our four values? Select all four.',
        [
          ['a', 'Clear over clever'],
          ['b', 'Own it'],
          ['c', 'Help first'],
          ['d', 'Respect how people work'],
          ['e', 'Move fast'],
          ['f', 'Win at all costs'],
        ],
        ['a', 'b', 'c', 'd'],
        'The four values are: clear over clever, own it, help first, and respect how people work.',
      ),
      q(
        'q3',
        'Which of these is not one of our values?',
        [
          ['a', 'Own it'],
          ['b', 'Help first'],
          ['c', 'Move fast'],
          ['d', 'Clear over clever'],
        ],
        'c',
        'The values are clear over clever, own it, help first, and respect how people work.',
      ),
      q(
        'q4',
        'Where are this year’s company goals presented?',
        [
          ['a', 'In the company introduction on your first day'],
          ['b', 'In an email after six months'],
          ['c', 'They are kept private'],
        ],
        'a',
        'This year’s company goals are presented in the company introduction on your first day.',
      ),
      q(
        'q5',
        'Which proposal fits our mission best?',
        [
          ['a', 'A change that saves a salon owner time on booking admin'],
          ['b', 'A change that adds manual steps for customers'],
          ['c', 'A change that only helps internal reporting'],
        ],
        'a',
        'Our mission is to help small service businesses spend less time on admin.',
      ),
    ],
  },
  teams: {
    title: 'How teams fit together',
    instructions:
      'Show what you know about the departments, using your “How teams fit together” summary.',
    objectives: ['Know the six departments and the first-month suggestion for meeting colleagues.'],
    questions: [
      q(
        'q1',
        'Which are UniVRse’s six departments? Select all six.',
        [
          ['a', 'Product and Engineering'],
          ['b', 'Customer Success'],
          ['c', 'Sales and Marketing'],
          ['d', 'Finance'],
          ['e', 'People and Culture'],
          ['f', 'Operations and Facilities'],
          ['g', 'Legal'],
          ['h', 'Research'],
        ],
        ['a', 'b', 'c', 'd', 'e', 'f'],
        'The six departments are Product and Engineering, Customer Success, Sales and Marketing, Finance, People and Culture, and Operations and Facilities.',
      ),
      q(
        'q2',
        'How many departments does UniVRse have?',
        [
          ['a', 'Four'],
          ['b', 'Six'],
          ['c', 'Nine'],
        ],
        'b',
        'UniVRse has six departments.',
      ),
      q(
        'q3',
        'Which of these is not one of the departments?',
        [
          ['a', 'Finance'],
          ['b', 'Customer Success'],
          ['c', 'Legal'],
          ['d', 'People and Culture'],
        ],
        'c',
        'The departments are Product and Engineering, Customer Success, Sales and Marketing, Finance, People and Culture, and Operations and Facilities.',
      ),
      q(
        'q4',
        'What are you encouraged to do in your first month?',
        [
          ['a', 'Meet one person from each department'],
          ['b', 'Wait until your manager arranges meetings'],
          ['c', 'Only work with your own department'],
        ],
        'a',
        'In your first month, try to meet one person from each department.',
      ),
      q(
        'q5',
        'How long is enough for each of those meetings?',
        [
          ['a', 'Fifteen minutes'],
          ['b', 'Two hours'],
          ['c', 'A full day'],
        ],
        'a',
        'Fifteen minutes with each of them is enough.',
      ),
    ],
  },
  roleContribution: {
    title: 'How your work connects to the company’s purpose',
    instructions:
      'Show how your work connects to what the company does, using your “How your role contributes” summary.',
    objectives: ['Connect your own role to the company’s purpose and know who to ask.'],
    questions: [
      q(
        'q1',
        'Which purpose does everything we do support?',
        [
          [
            'a',
            'Helping small service businesses spend less time on admin and more time with their customers',
          ],
          ['b', 'Maximising the number of meetings each team holds'],
          ['c', 'Keeping every team separate from the others'],
        ],
        'a',
        'Everything we do helps small service businesses spend less time on admin and more time with their customers.',
      ),
      q(
        'q2',
        'Whom should you ask how your work connects to this year’s company goals?',
        [
          ['a', 'Your manager'],
          ['b', 'Nobody; it is not discussed'],
          ['c', 'A customer'],
        ],
        'a',
        'Ask your manager how your work connects to this year’s company goals.',
      ),
      q(
        'q3',
        'You are planning your first tasks. What should you keep in mind?',
        [
          ['a', 'How each task helps small service businesses spend less time on admin'],
          ['b', 'Only how quickly you can finish them'],
          ['c', 'Nothing in particular'],
        ],
        'a',
        'Keep the link between your work and the company purpose in mind when you plan your first tasks.',
      ),
    ],
    notesPrompt:
      'Optional: in your own words, how might your role support this? Bring it to your manager. This note is stored in your own onboarding record and does not affect completion.',
  },
});

// Area 3: the responsibilities checklist is built from actions, not invented
// duties: detailed role responsibilities are a content requirement.
export const RESPONSIBILITY_ITEMS = Object.freeze([
  'I know my job title and department shown above.',
  'I have asked my manager what my main responsibilities are.',
  'I have agreed my first priorities with my manager.',
]);

// Area 4: situations whose answer is stated in the onboarding plan.
export const SUPPORT_ROUTING_SCENARIOS = Object.freeze([
  {
    id: 'sit-1',
    situation: 'You receive an email asking you for your password.',
    options: [
      { id: 'it', label: 'IT: forward it to it-help@univrse.example without clicking links' },
      { id: 'reply', label: 'Reply to the sender' },
      { id: 'click', label: 'Click the link to check it' },
    ],
    correctId: 'it',
    explanation:
      'Forward suspicious emails to IT at it-help@univrse.example without clicking links.',
  },
  {
    id: 'sit-2',
    situation: 'Your company laptop has been stolen.',
    options: [
      { id: 'wait', label: 'Wait a few days to see if it turns up' },
      { id: 'it', label: 'Report it to IT within 2 hours' },
      { id: 'later', label: 'Tell a colleague at the end of the week' },
    ],
    correctId: 'it',
    explanation: 'Report a lost or stolen laptop to IT within 2 hours.',
  },
  {
    id: 'sit-3',
    situation: 'You are not sure whether an outfit meets the dress code.',
    options: [
      { id: 'it', label: 'IT' },
      { id: 'manager-pc', label: 'Your manager or People and Culture' },
      { id: 'guess', label: 'Decide for yourself and see' },
    ],
    correctId: 'manager-pc',
    explanation: 'If you are unsure about an outfit, ask your manager or People and Culture first.',
  },
  {
    id: 'sit-4',
    situation: 'You have not received the invite link to your department’s chat group.',
    options: [
      { id: 'coordinator', label: 'Your onboarding coordinator' },
      { id: 'it', label: 'it-help@univrse.example' },
      { id: 'wait', label: 'Nobody; groups cannot be joined later' },
    ],
    correctId: 'coordinator',
    explanation: 'Ask your onboarding coordinator if you have not received the invite link yet.',
  },
  {
    id: 'sit-5',
    situation: 'You think your team needs an AI tool that is not on the approved list.',
    options: [
      { id: 'it', label: 'Ask IT first' },
      { id: 'manager', label: 'Start using it and tell IT later' },
      { id: 'pc', label: 'Ask People and Culture' },
    ],
    correctId: 'it',
    explanation: 'If you think you need a different AI tool, ask IT first.',
  },
  {
    id: 'sit-6',
    situation: 'You cannot find the invitation to open your Individual GSheet.',
    options: [
      { id: 'coordinator', label: 'Your onboarding coordinator, who sends that invitation' },
      { id: 'it', label: 'Nobody; create your own sheet' },
      { id: 'pc', label: 'A customer' },
    ],
    correctId: 'coordinator',
    explanation: 'The invitation to your Individual GSheet comes from the onboarding coordinator.',
  },
  {
    id: 'sit-7',
    situation: 'It is your first day and you wonder who checks your original documents.',
    options: [
      { id: 'pc', label: 'People and Culture' },
      { id: 'it', label: 'IT' },
      { id: 'manager', label: 'Nobody checks them' },
    ],
    correctId: 'pc',
    explanation: 'On your first day, People and Culture checks your original documents.',
  },
  {
    id: 'sit-8',
    situation: 'You have not been added to the company-wide chat groups.',
    options: [
      { id: 'coordinator', label: 'Your onboarding coordinator, who shares those groups' },
      { id: 'it', label: 'it-help@univrse.example' },
      { id: 'wait', label: 'Nobody; groups are optional and cannot be joined later' },
    ],
    correctId: 'coordinator',
    explanation: 'The company-wide chat groups are shared by your onboarding coordinator.',
  },
]);

// Support contacts that appear in the onboarding plan. Manager and first-day
// contact come from the employee profile and HR's first-day details.
export const VERIFIED_SUPPORT_DIRECTORY = Object.freeze({
  contacts: [
    {
      name: 'IT',
      email: 'it-help@univrse.example',
      purpose: 'Suspicious emails, lost or stolen devices, and asking before using a new AI tool',
    },
    {
      name: 'People and Culture',
      email: null,
      purpose: 'Questions about the dress code and other company rules; verifies your documents',
    },
    {
      name: 'Onboarding coordinator',
      email: null,
      purpose: 'Chat-group invitations, tool invitations and onboarding questions',
    },
  ],
});

// Routing scenarios as single-choice questions, so one engine runs every activity.
export const routingQuestions = (scenarios) =>
  scenarios.map((s) => ({
    id: s.id,
    type: 'single',
    multiple: false,
    prompt: s.situation,
    options: s.options.map((o) => ({ id: o.id, text: o.label })),
    correct: [s.correctId],
    explanation: s.explanation,
  }));

// Grades answers. single/multi: the selected options must equal the answer key.
// match: every pair must carry its key. Anything unanswered is wrong.
export function gradeQuestions(questions, answers = {}) {
  const results = questions.map((question) => {
    let correct;
    if (question.type === 'match') {
      const given =
        answers[question.id] && typeof answers[question.id] === 'object'
          ? answers[question.id]
          : {};
      correct = question.pairs.every((pair) => given[pair.id] === pair.correct);
    } else {
      const given = [].concat(answers[question.id] ?? []).map(String);
      correct =
        given.length === question.correct.length &&
        question.correct.every((id) => given.includes(id));
    }
    return { id: question.id, correct, ...(correct ? {} : { explanation: question.explanation }) };
  });
  const right = results.filter((result) => result.correct).length;
  return { results, score: Math.round((right / questions.length) * 100) };
}

export const stripAnswers = (questions) =>
  questions.map((question) =>
    question.type === 'match'
      ? {
          id: question.id,
          type: 'match',
          prompt: question.prompt,
          pairs: question.pairs.map(({ id, text }) => ({ id, text })),
          choices: question.choices,
        }
      : {
          id: question.id,
          type: question.multiple ? 'multi' : 'single',
          prompt: question.prompt,
          multiple: Boolean(question.multiple),
          options: question.options,
        },
  );

// What the browser may see: never the answer keys or explanations. `content`
// is the merged content from verification-content.mjs.
export function publicVerificationContent(content, env = process.env) {
  const policyScore = policyPassingScore(env);
  const alignmentScore = alignmentPassingScore(env);
  const policies = Object.fromEntries(
    Object.entries(content.policies).map(([id, policy]) => [
      id,
      {
        title: policy.title,
        sourceTitle: policy.sourceTitle,
        objectives: policy.objectives || [],
        ...(policy.document ? { document: policy.document } : {}),
        // A policy without approved quiz material is acknowledgement-only.
        quiz: policy.quiz
          ? { passingScore: policyScore, questions: stripAnswers(policy.quiz.questions) }
          : null,
      },
    ]),
  );
  const check = (activity) => ({
    title: activity.title,
    instructions: activity.instructions,
    objectives: activity.objectives || [],
    passingScore: alignmentScore,
    questions: stripAnswers(activity.questions),
    ...(activity.notesPrompt ? { notesPrompt: activity.notesPrompt } : {}),
  });
  return {
    policies,
    alignment: {
      products: check(ALIGNMENT_ACTIVITIES.products),
      values: check(ALIGNMENT_ACTIVITIES.values),
      teams: check(ALIGNMENT_ACTIVITIES.teams),
      roleContribution: check(ALIGNMENT_ACTIVITIES.roleContribution),
    },
    responsibilities: content.responsibilities,
    supportRouting: {
      title: 'Find the right contact',
      instructions: 'Choose the right contact or channel for each situation.',
      objectives: [
        'Know who to go to for IT, People and Culture, your manager and your coordinator.',
      ],
      passingScore: alignmentScore,
      questions: stripAnswers(routingQuestions(content.supportRouting)),
    },
    verifiedDirectory: content.directory,
    config: {
      policyPassingScore: policyScore,
      alignmentPassingScore: alignmentScore,
      allowRetries: true,
    },
  };
}

const storageError = () =>
  new ChatError(
    503,
    'VERIFICATION_STORAGE_UNAVAILABLE',
    'Your progress could not be saved or loaded because the storage service is unavailable. Please try again shortly.',
  );

// Verification records live in Firestore (taskVerifications/{accountId}). Without
// a configured Firestore (tests only) they stay in this process's memory; a
// Firestore that is configured but failing raises an error rather than falling
// back to memory, so nothing is ever reported as saved when it was not.
export function createTaskVerificationStore({
  firestore,
  now = () => new Date(),
  log = console.warn,
} = {}) {
  const memory = new Map();
  const config = () => ({ passingScore: policyPassingScore(), allowRetries: true });
  const getDb = async () => (typeof firestore === 'function' ? await firestore() : firestore);
  const ref = (db, id) => db.collection(journeyCollections.taskVerifications).doc(id);

  async function getVerifications(accountId) {
    if (!accountId) return { verifications: {}, config: config() };
    let db;
    try {
      db = await getDb();
      if (db) {
        const doc = await ref(db, accountId).get();
        return {
          verifications: (doc?.exists && doc.data().verifications) || {},
          config: config(),
        };
      }
    } catch (e) {
      log('task-verification: read error: ' + (e?.message || e));
      throw storageError();
    }
    return {
      verifications: structuredClone(memory.get(accountId)?.verifications || {}),
      config: config(),
    };
  }

  // Read-modify-write in one transaction, so two quick submissions never lose each other.
  async function saveVerification(accountId, updater) {
    let db;
    try {
      db = await getDb();
      if (db) {
        return await db.runTransaction(async (tx) => {
          const doc = await tx.get(ref(db, accountId));
          const current = (doc?.exists && doc.data().verifications) || {};
          const record = {
            accountId,
            updatedAt: now().toISOString(),
            verifications: updater(current),
          };
          tx.set(ref(db, accountId), record);
          return { ...record, config: config() };
        });
      }
    } catch (e) {
      if (e instanceof ChatError) throw e;
      log('task-verification: write error: ' + (e?.message || e));
      throw storageError();
    }
    const record = {
      accountId,
      updatedAt: now().toISOString(),
      verifications: updater(structuredClone(memory.get(accountId)?.verifications || {})),
    };
    memory.set(accountId, record);
    return { ...record, config: config() };
  }

  return { getVerifications, saveVerification };
}
