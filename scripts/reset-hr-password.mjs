// npm run hr:reset-password: recovers an HR account without editing the
// database. Input rules are in hr-account-tool.mjs: terminal prompts without
// echo, or piped lines (HR ID, new password, new password again); never
// arguments.
//
//   printf '%s\n%s\n%s\n' HR-0001 "$PASSWORD" "$PASSWORD" | npm run hr:reset-password
//
// HR accounts only (employees are reset by HR through the API). Sets the new
// password with no forced change, clears failed attempts and any lock, ends
// every session of the account and records an hr_password_reset event.
import { resetHrAccountPassword, runHrCommand } from './hr-account-tool.mjs';

await runHrCommand({
  command: 'hr:reset-password',
  action: resetHrAccountPassword,
  passwordLabel: 'New password',
});
