// The built-in onboarding footprint (issue #47) and quick-question chips
// (issue #50). The Firestore migrations copy these into
// onboardingTemplates/{track} and config/quickQuestions; the server falls back
// to them whenever those documents are missing, malformed or older than this
// version. See docs/onboarding-journey.md.
//
// Any change to this content needs a templateVersion bump AND a Firestore
// migration that writes the new version (like 003_onboarding_templates_v2):
// the migrations are forward-only, and a migration that already ran never
// runs again, so a stack seeded with the old content keeps it otherwise.
//
// Step ids are "<areaId>.<slug>" and stable forever: onboardingProgress is keyed
// by them. A track keeps the same id for the same structural step (an intern's
// internship agreement is documentation.contract), so changing an employee's
// track keeps the progress that still applies.
//
// Every track has exactly four required steps per area; a track substitutes
// steps rather than dropping them. Optional steps (required: false) never count.
// Every required step has Alya's briefing (contract v1.5): 2 to 4 plain
// sentences, at most 400 characters, with no links, lists or headings so it
// reads well aloud, grounded in the company documents named by sourceTitle
// (null where the documents do not cover the step, and the text then states no
// company facts). The policy checks (contract v1.4) are grounded in the
// Employee Handbook (version 3.2, effective 1 October 2026). Only short
// paraphrases are kept here, never the document text.

export const tracks = Object.freeze(['employee', 'intern', 'contractor']);
export const defaultTrack = 'employee';
export const areaOrder = Object.freeze([
  'documentation',
  'policies',
  'alignment',
  'role-tools',
  'team-support',
]);
export const completionTypes = Object.freeze(['self', 'hr_verify', 'check']);
export const checkTypes = Object.freeze(['choice', 'written']);
export const templateVersion = 2;
// Every area must reach this percent of its required steps (contract v1.2).
export const completionThreshold = 70;
export const briefingMaxLength = 400;
export const writtenAnswerMaxLength = 600;
export const handbookTitle = 'UniVRse - Employee Handbook';
export const checklistTitle = 'UniVRse - New Staff Checklist';
export const orientationTitle = 'UniVRse - Orientation & Office Tour Guide';
export const contractTitle = 'UniVRse - Signing Your Employment Contract';

// A profile's job.track as a track: '' (or anything unknown) means employee.
export const trackOf = (profile) =>
  tracks.includes(profile?.job?.track) ? profile.job.track : defaultTrack;

const briefing = (sourceTitle, text) => ({ text, sourceTitle });
const self = (slug, title, description, askAlya, brief) => ({
  slug,
  title,
  description,
  required: true,
  completion: 'self',
  askAlya,
  briefing: brief,
});
const hrVerify = (slug, title, description, askAlya, brief) => ({
  slug,
  title,
  description,
  required: true,
  completion: 'hr_verify',
  askAlya,
  briefing: brief,
});
const checked = (slug, title, description, askAlya, brief, check) => ({
  slug,
  title,
  description,
  required: true,
  completion: 'check',
  askAlya,
  briefing: brief,
  check: { ...check, sourceTitle: handbookTitle },
});

// The four Policies & Safe Practices checks, one per policy step, grounded in
// the Employee Handbook (contract v1.4):
// - choice checks (dress code, workplace conduct): option ids are opaque and
//   stable, so an id says nothing about its position, and GET .../check
//   shuffles the options on every request;
// - written checks (personal data, responsible AI): the employee writes an
//   answer that Alya grades against keyPoints and mustNot; the server decides
//   the pass (check-grader.mjs). The modelAnswer and the rubric are never sent
//   to the browser.
const checks = {
  handbook: {
    type: 'choice',
    scenario:
      'It is a Friday and you have no client meetings or events. Which outfit fits the dress code?',
    options: [
      { id: 'q4m7', text: 'Denim shorts, a plain T-shirt and clean sneakers' },
      { id: 'z2k9', text: 'A gym tracksuit, a plain T-shirt and running shoes' },
      { id: 'h8t3', text: 'Long jeans, a plain T-shirt and clean sneakers' },
    ],
    correctOptionId: 'h8t3',
    explanation:
      'Casual Friday allows long jeans, plain or tasteful T-shirts and clean sneakers. Short pants of any kind, including denim shorts, are not allowed on any working day, and sportswear is only for company sports events.',
  },
  conduct: {
    type: 'choice',
    scenario:
      'An email that says it is from IT asks you to reply with your password so your account can be “verified”. What should you do?',
    options: [
      { id: 'w5n1', text: 'Forward it to it-help@univrse.example, then delete it' },
      { id: 'c3x8', text: 'Reply with your password so that IT can verify you' },
      { id: 'p9v2', text: 'Open the link in it to check that the request is real' },
    ],
    correctOptionId: 'w5n1',
    explanation:
      'Never share your password, including with IT: IT will never ask for it. Forward suspicious emails to it-help@univrse.example and do not click their links or open their attachments.',
  },
  data: {
    type: 'written',
    scenario:
      'A colleague asks you to copy a customer list to your personal Google Drive, so the two of you can work on it at home over the weekend. What do you do, and why? Answer in two or three sentences.',
    keyPoints: [
      {
        id: 'kp-no-personal-copy',
        text: 'Says they will not copy the customer list to a personal device or a personal account (they decline, or keep the list in company systems instead).',
      },
      {
        id: 'kp-confidential',
        text: 'Gives the reason: customer data is confidential and may be used only to do their job.',
      },
    ],
    mustNot: [
      {
        id: 'mn-copies-personal',
        text: 'Agrees to copy, email, upload or move the customer list to a personal device, personal email or personal cloud storage, even for a short time.',
      },
      {
        id: 'mn-shares-outside',
        text: 'Suggests sharing the customer list with people or tools that have no work need for it.',
      },
    ],
    modelAnswer:
      'I would decline and keep the customer list in our company systems, working on it there with my UniVRse account. Customer data is confidential and may be used only to do our jobs, so it must never be copied to personal devices or accounts.',
    explanation:
      'Customer data is confidential. It may be used only to do your job and must never be copied to personal devices or accounts, during or after your employment.',
    maxLength: writtenAnswerMaxLength,
  },
  ai: {
    type: 'written',
    scenario:
      'You are stuck on a bug and would like an AI tool to explain some UniVRse source code. A friend recommends a free AI chatbot. What do you do? Answer in two or three sentences.',
    keyPoints: [
      {
        id: 'kp-approved-tool',
        text: 'Uses only an approved AI tool, such as Alya or Gemini in their UniVRse company account, or asks IT before using any other tool.',
      },
      {
        id: 'kp-no-unapproved-paste',
        text: 'Says they will not paste the source code into the free chatbot or any other AI tool that IT has not approved.',
      },
    ],
    mustNot: [
      {
        id: 'mn-pastes-unapproved',
        text: 'Pastes or uploads the source code into the free chatbot or another AI tool that IT has not approved.',
      },
      {
        id: 'mn-copies-code-out',
        text: 'Copies the source code to a personal device or personal account so they can use another AI tool.',
      },
    ],
    modelAnswer:
      'I would not paste the code into the free chatbot, because source code must never go into an AI tool that IT has not approved. Instead I would ask Alya or Gemini in my UniVRse account, or check with IT first if I need a different tool.',
    explanation:
      'Use only approved AI tools, such as Alya and Gemini in your UniVRse account. Never paste customer data, payslips or source code into an AI tool that IT has not approved.',
    maxLength: writtenAnswerMaxLength,
  },
};

// The user's area titles, descriptions and icons (contract v1.2, verbatim).
const areaText = {
  documentation: {
    icon: '📄',
    title: 'Documentation',
    description: 'Complete required forms and submit documents.',
  },
  policies: {
    icon: '🛡️',
    title: 'Policies & Safe Practices',
    description: 'Understand company rules, privacy and responsible AI use.',
  },
  alignment: {
    icon: '🎯',
    title: 'Company Purpose & Alignment',
    description: 'Understand what the company does, its goals and how your role contributes.',
  },
  'role-tools': {
    icon: '🛠️',
    title: 'Role, Tools & AI Readiness',
    description:
      'Set up work tools, understand your responsibilities and identify suitable AI training.',
  },
  'team-support': {
    icon: '🤝',
    title: 'People & Workplace Support',
    description:
      'Know your teammates, who to ask for help and optionally share working preferences or support needs.',
  },
};

// Every track has exactly four REQUIRED steps per area (the 70% rule is then
// 3 of 4 everywhere); interns and contractors substitute steps instead of
// dropping them. Optional steps never count.
const policies = [
  checked(
    'employee-handbook',
    'Company rules (Employee Handbook)',
    'Read the Employee Handbook, especially working hours and dress code, then answer a short scenario.',
    'What does the Employee Handbook say about the dress code?',
    briefing(
      handbookTitle,
      'Our dress code is smart casual from Monday to Thursday. On casual Friday, long jeans, plain T-shirts and clean sneakers are fine. Short pants of any kind are not allowed on any working day, and sportswear is only for company sports events. If you are unsure about an outfit, ask your manager or People and Culture first.',
    ),
    checks.handbook,
  ),
  checked(
    'workplace-conduct',
    'Workplace conduct & safe practices',
    'Learn how we treat each other and keep accounts and devices safe, then answer a short scenario.',
    'What should I do with a suspicious email or a lost laptop?',
    briefing(
      handbookTitle,
      'Treat colleagues, customers and partners with respect: bullying, discrimination and harassment are not tolerated. Never share your password, not even with IT, because IT will never ask for it. Forward suspicious emails to IT without clicking their links, and report a lost or stolen laptop to IT within 2 hours.',
    ),
    checks.conduct,
  ),
  checked(
    'data-protection',
    'Privacy & data handling (PDPA)',
    'Learn how personal and customer data is protected, then answer a short scenario in your own words.',
    'How should I handle customer and personal data?',
    briefing(
      handbookTitle,
      'UniVRse handles personal data in line with Malaysia’s Personal Data Protection Act 2010. Customer data, prices, source code and business plans are confidential, during and after your employment. Use customer data only to do your job, and never copy it to a personal device or a personal account.',
    ),
    checks.data,
  ),
  checked(
    'responsible-ai',
    'Responsible AI use',
    'Learn which AI tools are approved and what must never go into them, then answer a short scenario in your own words.',
    'Which AI tools am I allowed to use at work?',
    briefing(
      handbookTitle,
      'Use only approved AI tools, such as Alya and Gemini in your UniVRse account. Never paste customer data, payslips or source code into an AI tool that IT has not approved. If you think you need a different tool, ask IT first.',
    ),
    checks.ai,
  ),
];
const alignment = [
  self(
    'products-customers',
    'What the company does',
    'Learn what we build and who our customers are.',
    'What does the company do, and who are our customers?',
    briefing(
      handbookTitle,
      'UniVRse builds booking and scheduling software for clinics, salons and wellness studios in Malaysia and Singapore. Our two products are UniVRse Book, for bookings and scheduling, and UniVRse Pay, for payments. About 2,400 businesses use them today.',
    ),
  ),
  self(
    'mission-values',
    'Mission, values and goals',
    'Learn what the company stands for, the values we work by and this year’s goals.',
    'What are the company’s mission, values and goals?',
    briefing(
      handbookTitle,
      'Our mission is to help small service businesses spend less time on admin and more time with their customers. We work by four values: clear over clever, own it, help first, and respect how people work. This year’s company goals are presented in the company introduction on your first day.',
    ),
  ),
  self(
    'org-structure',
    'How teams fit together',
    'Get to know the departments and how they work together.',
    'How do the departments work together?',
    briefing(
      handbookTitle,
      'UniVRse has six departments: Product and Engineering, Customer Success, Sales and Marketing, Finance, People and Culture, and Operations and Facilities. In your first month, try to meet one person from each department. Fifteen minutes with each of them is enough.',
    ),
  ),
  self(
    'role-contribution',
    'How your role contributes',
    'Understand how your work supports the company’s goals.',
    'How does my role contribute to the company’s goals?',
    briefing(
      handbookTitle,
      'Everything we do helps small service businesses spend less time on admin and more time with their customers. Ask your manager how your work connects to this year’s company goals, and keep that link in mind when you plan your first tasks.',
    ),
  ),
];
const aiTrainingStep = (brief) =>
  self(
    'ai-training',
    'Identify suitable AI training',
    'Find an AI training that suits your role and note it for your learning plan.',
    'Which AI training suits my role?',
    brief,
  );
const aiTraining = aiTrainingStep(
  briefing(
    handbookTitle,
    'After confirmation, you have a learning budget of up to 2,000 ringgit a year for courses, books and exams related to your role. Ask your manager which AI training suits your work, and note it for your learning plan. At work, use only approved AI tools, such as Alya and Gemini.',
  ),
);
const aiTrainingWithoutBudget = aiTrainingStep(
  briefing(
    handbookTitle,
    'Ask the person you report to which AI training suits your work, and note it for your learning plan. At work, use only approved AI tools, such as Alya and Gemini in your UniVRse account.',
  ),
);
const helpContacts = self(
  'help-contacts',
  'Know who to ask for help',
  'Know how to reach People & Culture (HR) and IT Support.',
  'Who do I contact for HR and IT help?',
  briefing(
    handbookTitle,
    'If you are not sure who to ask, ask Alya first. For leave, benefits, your contract or onboarding, contact People and Culture. For your laptop, accounts, passwords or the VPN, contact IT Support.',
  ),
);
const workingPreferences = {
  ...self(
    'working-preferences',
    'Share your working preferences or support needs (optional)',
    'If you would like to, tell your manager or People & Culture how you prefer to work, or about any support you need. This never affects your progress.',
    'How can I share my working preferences or support needs?',
    null,
  ),
  required: false,
};
const meetTeammates = self(
  'meet-teammates',
  'Meet your teammates',
  'Get to know the people you work with every day.',
  'How will I meet my teammates?',
  briefing(
    orientationTitle,
    'On your first day, you have a team lunch with your manager and buddy, and later you meet your team and set up your desk. During your first week, you shadow a teammate for half a day, and on Friday there is a team lunch.',
  ),
);
const workTools = self(
  'work-tools',
  'Email, chat and work tools access',
  'Check that your email, Google Chat and role tools work, and join your team’s spaces.',
  'How do I get access to email, chat and my work tools?',
  briefing(
    handbookTitle,
    'Sign in to email and Google Chat with your UniVRse account, and join your team’s Google Chat spaces and recurring meetings. Install software only from the UniVRse Software Centre unless IT approves it. On public or hotel Wi-Fi, turn on the company VPN first.',
  ),
);
const emergencyContact = hrVerify(
  'emergency-contact',
  'Submit your emergency contact form',
  'Add an emergency contact in UniVRse HR, under My Profile. HR verifies it.',
  'How do I add my emergency contact?',
  briefing(
    checklistTitle,
    'Add an emergency contact in UniVRse HR, under My Profile, if you have not done so already. The New Staff Checklist asks you to do this in your first week. Once it is there, mark this step as submitted and HR verifies it.',
  ),
);
const stepsByTrack = {
  employee: {
    documentation: [
      hrVerify(
        'contract',
        'Sign your employment contract',
        'Sign your contract electronically in UniVRse HR, then mark it as submitted. HR verifies it.',
        'How do I sign my employment contract?',
        briefing(
          contractTitle,
          'You sign your employment contract electronically in UniVRse HR, within 5 working days of receiving it. Before you sign, check your job title, start date, salary, probation period and work location, and ask People and Culture if anything looks wrong. A signed copy is emailed to you, and HR then verifies it.',
        ),
      ),
      hrVerify(
        'personal-bank-details',
        'Submit your personal and bank details',
        'Fill in the onboarding form with your bank, EPF and tax details. HR verifies it.',
        'What details do I need for the onboarding form?',
        briefing(
          contractTitle,
          'The onboarding form in UniVRse HR asks for your IC or passport number, home address, bank account, EPF number, income tax number and an emergency contact. Please finish it before your first day, so that your account, laptop and pay are ready. HR verifies the details once you submit them.',
        ),
      ),
      hrVerify(
        'tax-id-documents',
        'Show your tax and ID documents',
        'Bring your original IC or passport, certificates and tax numbers on day 1. HR verifies them.',
        'Which documents do I bring on my first day?',
        briefing(
          contractTitle,
          'On your first day, People and Culture checks your original documents at 9:15 in the morning. Bring your MyKad or passport, your highest education certificate and transcript, a bank statement or bank card, and your EPF and income tax numbers if you have them. HR then verifies them.',
        ),
      ),
      emergencyContact,
    ],
    policies,
    alignment,
    'role-tools': [
      self(
        'laptop-accounts',
        'Set up your laptop and accounts',
        'Collect your laptop and sign in to your company account with 2-step verification.',
        'How do I set up my laptop and company account?',
        briefing(
          handbookTitle,
          'On your first day, you collect your laptop, headset and access card. Your UniVRse Google account is your single sign-in for email, chat, UniVRse HR and internal tools, and it must use 2-step verification from day 1. Keep your laptop locked whenever you step away.',
        ),
      ),
      workTools,
      hrVerify(
        'role-responsibilities',
        'Agree your responsibilities with your manager',
        'Agree your responsibilities and 30-day goals with your manager. HR verifies it.',
        'When do I agree my responsibilities and 30-day goals with my manager?',
        briefing(
          checklistTitle,
          'In your first week, you have a one-to-one with your manager to agree your 30-day goals. It is also a good time to say how you prefer to receive instructions, for example written steps, a short call or a checklist. Once you have agreed them, HR verifies it.',
        ),
      ),
      aiTraining,
    ],
    'team-support': [
      self(
        'meet-manager',
        'Meet your manager',
        'Have your first conversation with your manager.',
        'When will I meet my manager?',
        briefing(
          orientationTitle,
          'On your first day, your manager joins the team lunch, and at 3:45 in the afternoon they help you meet your team and set up your desk. Later in your first week, you have a one-to-one with them to agree your 30-day goals.',
        ),
      ),
      meetTeammates,
      self(
        'meet-buddy',
        'Meet your buddy',
        'Meet the buddy who helps you through your first weeks.',
        'What does my onboarding buddy do?',
        briefing(
          orientationTitle,
          'Your manager assigns you a buddy from your team before your first day. Your buddy stays with you from lunch on day 1, gives you the office tour and helps you with your first small task. At the end of your first week, you have a check-in with your buddy.',
        ),
      ),
      helpContacts,
      workingPreferences,
    ],
  },
};

// Interns: the same steps, with intern wording.
stepsByTrack.intern = {
  ...stepsByTrack.employee,
  documentation: [
    hrVerify(
      'contract',
      'Sign your internship agreement',
      'Sign your internship agreement in UniVRse HR, then mark it as submitted. HR verifies it.',
      'How do I sign my internship agreement?',
      briefing(
        contractTitle,
        'Interns sign an internship agreement, not the employment contract. It sets out your monthly allowance, your internship dates and the benefits for interns. Sign it electronically in UniVRse HR, and ask People and Culture if anything is unclear. HR then verifies it.',
      ),
    ),
    hrVerify(
      'personal-bank-details',
      'Submit your personal and bank details',
      'Fill in the onboarding form with the bank details your allowance is paid to. HR verifies it.',
      'What details do I need for the onboarding form?',
      briefing(
        contractTitle,
        'Fill in the onboarding form in UniVRse HR with your personal details, an emergency contact and the bank account your allowance is paid to. Please finish it before your first day. HR verifies the details once you submit them.',
      ),
    ),
    hrVerify(
      'tax-id-documents',
      'Show your ID and placement documents',
      'Bring your original IC or passport, your university placement letter and insurance form on day 1. HR verifies them.',
      'Which documents do interns bring on the first day?',
      briefing(
        contractTitle,
        'On your first day, People and Culture checks your original documents at 9:15 in the morning. Bring your MyKad or passport, your university placement letter and your insurance form. HR then verifies them.',
      ),
    ),
    emergencyContact,
  ],
  'role-tools': [
    ...stepsByTrack.employee['role-tools'].slice(0, 2),
    hrVerify(
      'role-responsibilities',
      'Agree internship goals with your supervisor',
      'Agree your internship goals and how you like to receive instructions with your supervisor. HR verifies it.',
      'When do I agree my internship goals with my supervisor?',
      briefing(
        checklistTitle,
        'In your first week, you meet your supervisor one-to-one to agree your internship goals. Tell them how you prefer to receive instructions, for example written steps, a short call or a checklist. Once you have agreed them, HR verifies it.',
      ),
    ),
    aiTrainingWithoutBudget,
  ],
  'team-support': [
    self(
      'meet-manager',
      'Meet your supervisor',
      'Have your first conversation with your internship supervisor.',
      'When will I meet my internship supervisor?',
      briefing(
        orientationTitle,
        'Your internship supervisor guides your work. On your first day, they help you meet your team and set up your desk, and in your first week you agree your internship goals together.',
      ),
    ),
    ...stepsByTrack.employee['team-support'].slice(1),
  ],
};

// Contractors: substitutes for the steps that do not apply (an employment
// contract, payroll forms, a buddy), still four required steps per area. The
// company documents do not describe contractor agreements, so those briefings
// have no source and state no company facts.
stepsByTrack.contractor = {
  documentation: [
    hrVerify(
      'contract',
      'Sign your service agreement',
      'Sign the service agreement for your engagement, then mark it as submitted. HR verifies it.',
      'How do I sign my service agreement?',
      briefing(
        null,
        'Your service agreement sets out the terms of your engagement with UniVRse. Read it carefully, and ask People and Culture about anything that is unclear before you sign. Once you mark it as submitted, HR verifies it.',
      ),
    ),
    hrVerify(
      'personal-bank-details',
      'Submit your billing and bank details',
      'Give HR the billing details and bank account your invoices are paid to. HR verifies them.',
      'Which billing and bank details does HR need from me?',
      briefing(
        null,
        'HR needs your billing details and the bank account your invoices are paid to. Check that they match your service agreement before you submit them. HR then verifies them.',
      ),
    ),
    hrVerify(
      'tax-id-documents',
      'Show your ID document',
      'Show your IC or passport so your building access can be set up. HR verifies it.',
      'Which ID document do I need to show?',
      briefing(
        orientationTitle,
        'Show your MyKad or passport so that your building access can be set up. On your first day, register with the lobby guard using your IC, and from day 2 use your UniVRse access card at the lobby gates. HR verifies your document.',
      ),
    ),
    hrVerify(
      'confidentiality-agreement',
      'Sign the confidentiality agreement (NDA)',
      'Sign the confidentiality agreement that covers customer data, prices and source code. HR verifies it.',
      'What does the confidentiality agreement cover?',
      briefing(
        handbookTitle,
        'The confidentiality agreement covers customer data, prices, source code and business plans. Keep them confidential during and after your engagement, and use customer data only to do your work. HR verifies the signed agreement.',
      ),
    ),
  ],
  policies,
  alignment,
  'role-tools': [
    self(
      'laptop-accounts',
      'Set up the accounts you were given',
      'Sign in to the company account you were given, with 2-step verification.',
      'How do I set up my company account?',
      briefing(
        handbookTitle,
        'Sign in to the UniVRse Google account you were given. It is your single sign-in for email, chat and internal tools, and it must use 2-step verification from day 1. Never share your password, not even with IT.',
      ),
    ),
    workTools,
    hrVerify(
      'role-responsibilities',
      'Agree your scope of work',
      'Agree the scope, deliverables and contacts of your engagement. HR verifies it.',
      'Who do I agree my scope of work with?',
      briefing(
        null,
        'Agree the scope, deliverables and contacts of your engagement with your project lead. Write down what you agreed, so that you both have the same picture. HR then verifies it.',
      ),
    ),
    aiTrainingWithoutBudget,
  ],
  'team-support': [
    self(
      'meet-manager',
      'Meet your project lead',
      'Have your first conversation with the person you report to.',
      'Who is my main contact for my work?',
      briefing(
        null,
        'Your project lead is the person you report to for your engagement. Have a first conversation with them about your scope, and tell them how you prefer to receive instructions.',
      ),
    ),
    {
      ...meetTeammates,
      briefing: briefing(
        checklistTitle,
        'Get to know the people you work with every day. Join your team’s Google Chat spaces and recurring meetings, and ask your project lead to introduce you to the team.',
      ),
    },
    self(
      'day-to-day-contact',
      'Meet your day-to-day contact',
      'Meet the colleague you go to with everyday questions about your engagement.',
      'Who can I ask everyday questions about my work?',
      briefing(
        handbookTitle,
        'Your day-to-day contact is the colleague you go to with everyday questions about your engagement. If you are not sure who to ask, ask Alya first, and then People and Culture.',
      ),
    ),
    helpContacts,
    workingPreferences,
  ],
};

// The template document for a track, as stored in onboardingTemplates/{track}.
export function builtInTemplate(track = defaultTrack) {
  const chosen = tracks.includes(track) ? track : defaultTrack;
  return {
    track: chosen,
    version: templateVersion,
    threshold: completionThreshold,
    areas: areaOrder.map((areaId) => ({
      id: areaId,
      icon: areaText[areaId].icon,
      title: areaText[areaId].title,
      description: areaText[areaId].description,
      steps: stepsByTrack[chosen][areaId].map(({ slug, check, briefing: brief, ...step }) => ({
        id: `${areaId}.${slug}`,
        ...step,
        briefing: brief ? { ...brief } : null,
        ...(check ? { check: structuredClone(check) } : {}),
      })),
    })),
  };
}

// config/quickQuestions: the general chips per track. Personal chips are
// answered from the employee's first-day details, never from the documents.
const generalChips = () => [
  {
    id: 'company-background',
    label: 'Explain the company background',
    question: 'Explain the company background',
    kind: 'knowledge',
  },
  {
    id: 'working-hours',
    label: 'What are the working hours?',
    question: 'What are the working hours?',
    kind: 'knowledge',
  },
  {
    id: 'dress-code',
    label: 'What’s the dress code?',
    question: 'What’s the dress code?',
    kind: 'knowledge',
  },
  {
    id: 'day-one-arrival',
    label: 'Where and what time do I report on day 1?',
    question: 'Where and what time do I report on day 1?',
    kind: 'personal',
    personal: 'arrival',
  },
  {
    id: 'day-one-host',
    label: 'Who will meet me on my first day?',
    question: 'Who will meet me on my first day?',
    kind: 'personal',
    personal: 'host',
  },
];
export function builtInQuickQuestions() {
  return Object.fromEntries(tracks.map((track) => [track, generalChips()]));
}
