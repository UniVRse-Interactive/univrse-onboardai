// npm run hr:create: creates an HR account, since there is no public sign-up.
// Input rules are in hr-account-tool.mjs: terminal prompts without echo, or
// piped lines (HR ID, password, password again); never arguments.
//
//   printf '%s\n%s\n%s\n' HR-0001 "$PASSWORD" "$PASSWORD" | npm run hr:create
//
// The new account does not need a forced password change.
import { createHrAccount, runHrCommand } from './hr-account-tool.mjs';

await runHrCommand({ command: 'hr:create', action: createHrAccount, passwordLabel: 'Password' });
