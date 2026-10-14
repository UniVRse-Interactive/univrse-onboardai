// Check the files Git would share. Never print a credential or private value.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8',
});
if (listing.status !== 0) {
  console.error('Run this check from the project Git folder.');
  process.exit(1);
}
const files = [...new Set(listing.stdout.split('\0').filter(Boolean))];
const problems = [];
const privateFile =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials[^/]*\.json|service-account[^/]*\.json|client_secret[^/]*\.json|application_default_credentials\.json)$|\.(?:sqlite(?:-wal|-shm)?|db|pem|key)$/i;
const privateFolder = /^(?:node_modules|dist|\.cache|artifacts|private)\//;
const textFiles = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.json',
  '.md',
  '.css',
  '.html',
  '.yaml',
  '.yml',
  '.txt',
  '.ps1',
  '.cs',
]);
const secrets = [
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['GitHub token', /(?:ghp_|gho_|github_pat_)[0-9A-Za-z_]{20,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['assigned Gemini key', /GEMINI_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_.-]{24,}/],
];
let totalBytes = 0;
for (const file of files) {
  if (file !== '.env.example' && (privateFile.test(file) || privateFolder.test(file))) {
    problems.push(file + ': private/generated file would be shared');
    continue;
  }
  let stats;
  try {
    stats = statSync(file);
  } catch {
    continue;
  }
  if (!stats.isFile()) continue;
  totalBytes += stats.size;
  if (stats.size > 100 * 1024 * 1024)
    problems.push(file + ': larger than the normal GitHub file limit');
  if (stats.size > 2 * 1024 * 1024 || !textFiles.has(extname(file))) continue;
  const contents = readFileSync(file, 'utf8');
  for (const [label, pattern] of secrets) {
    if (pattern.test(contents)) problems.push(file + ': possible ' + label + '; inspect privately');
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${files.length} shareable files (${(totalBytes / 1024 / 1024).toFixed(1)} MiB). No private files or recognised secret patterns found. This check does not publish anything.`,
  );
