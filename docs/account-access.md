# Account access and guest workspace

The welcome page at `/` or `/login` offers Employee and HR workspace choices.
Employees also have a sign-up interface at `/signup`. HR has sign-in only.
The existing portal dashboard is now at `/dashboard`.

## What works in this interface

- Switching Employee and HR workspace choices.
- Switching employee sign-in and sign-up forms.
- Employee ID and HR ID fields, with required-field validation. Employee sign-up also uses Employee ID.
- Password visibility controls, an eight-character minimum for sign-up and confirmation matching.
- Password-reset guidance with an explicit preview message.
- Employee guest entry into `/employee`, reopening that browser’s active guest.
- HR guest entry into `/hr`, with company uploads and live guest summaries. The old `/hr-preview` address opens the same workspace.
- A Sign in link in the existing portal header to return to the account interface.

## Authentication boundary

These screens are an interface preview, not account authentication or an access gate.
Sign-in and sign-up submissions do not call a server, create an account, grant HR
permissions or save/log credentials. After a valid submission, passwords are cleared
and a message states that account access is not connected. Password mismatch messages
allow the employee to correct their input. No password reset email is sent.

The Employee/HR selector does not verify a company role. Temporary HR and employee access uses one isolated browser workspace for uploads, distinct employee conversations and automatic support summaries, with the configured company document search (Vertex AI Search) available to the assistant. Every guest begins with zero activity. The former fictional employee reports were removed.

Existing saved chats and private reports remain separate and are not opened by guest APIs. Employee chat has no onboarding report or export control, and its API responses omit aggregate summaries. Existing collection preferences are preserved. Real workforce reports require verified HR permissions and company membership.

See [Company uploads and live reports](guest-workspace.md) for the working flow, limits, storage, expiry and deployment boundary.

## Files

- `src/access/LoginPage.jsx`: workspace selection, sign-in and employee sign-up forms.
- `src/access/HrWorkspace.jsx`: automatic individual employee reports.
- `src/access/CompanyDocumentLibrary.jsx`: upload and connected document library.
- `src/access/hr-report-insights.mjs`: team totals and explicit activity labels.
- `src/access/hr-onboarding-summary.css`: responsive HR summary layout.
- `src/access/account-access.css`: responsive access-screen and preview styling.
- `src/portal/OnboardingWebsite.jsx`: routes and guest-preview navigation.
