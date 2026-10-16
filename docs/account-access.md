# Account access and guest workspace

Employee and HR access have separate pages: `/login/employee` and `/login/hr`. Each route fixes the workspace, ID field and guest destination. A header link navigates to the other login page; there is no shared role selector in the form.
Employee sign-up is at `/signup/employee`. HR has sign-in only. Older `/`, `/login` and `/signup` links still open the corresponding employee access screen.
The existing portal dashboard is now at `/dashboard`.

The slate and aqua layout uses a quiet brand panel with Alya's portrait beside a muted reading surface for account access. Desktop forms fit the tested 1280 × 720 and 812 × 668 viewports; the employee sign-up form groups its fields into two columns. On smaller screens the decorative panel is omitted and inputs retain readable sizes. Short screens and zoom can use natural page flow rather than clipping controls.

## What works in this interface

- Separate, directly linkable Employee and HR login pages.
- Switching employee sign-in and sign-up forms.
- Employee ID and HR ID fields, with required-field validation. Employee sign-up also uses Employee ID.
- Password visibility controls, an eight-character minimum for sign-up and confirmation matching.
- Password-reset guidance with an explicit preview message.
- Employee guest entry opens `/dashboard` first. Ask Alya then reopens that browser’s active guest conversation space.
- HR guest entry into `/hr`, with Google Docs and live employee summaries. The old `/hr-preview` address opens the same workspace.
- Back to sign in returns employees to `/login/employee` and HR to `/login/hr`.

## Authentication boundary

These screens are an interface preview, not account authentication or an access gate.
Sign-in and sign-up submissions do not call a server, create an account, grant HR
permissions or save/log credentials. After a valid submission, passwords are cleared
and a message states that account access is not connected. Password mismatch messages
allow the employee to correct their input. No password reset email is sent.

Separate login URLs do not verify a company role. Temporary HR and employee access uses one isolated browser workspace for uploads, distinct employee conversations and automatic support summaries, with connected Drive guidance available to the assistant. Every guest begins with zero activity. The former fictional employee reports were removed.

The optional local **Save to company Drive** action moves Google Docs into the configured shared company folder. Those documents become shared company sources; employee conversations and reports retain their browser ownership. This write action is blocked in production and through proxies until HR authentication is implemented. See the linked workspace documentation for its limits and required Google permissions.

Existing Drive-backed chat and private reports remain separate and are not opened by guest APIs. Employee chat has no onboarding report or export control, and its API responses omit aggregate summaries. Existing collection preferences are preserved. Real workforce reports require verified HR permissions and company membership.

See [Company uploads and live reports](guest-workspace.md) for the working flow, limits, storage, expiry and deployment boundary.

## Files

- `src/access/LoginPage.jsx`: role-specific sign-in pages and employee sign-up form, sharing presentation code.
- `src/access/HrWorkspace.jsx`: automatic individual employee reports.
- `src/access/GoogleDocsLibrary.jsx`: Google Docs connection and topic library.
- `src/access/hr-report-insights.mjs`: team totals and explicit activity labels.
- `src/access/hr-onboarding-summary.css`: responsive HR summary layout.
- `src/access/account-access.css`: responsive access-screen and preview styling.
- `src/access/login-page.css`: scoped slate and aqua styling for the separate login pages.
- `src/portal/OnboardingWebsite.jsx`: routes and guest-preview navigation.
