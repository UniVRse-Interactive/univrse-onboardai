// npm run check:voice: a live check that Alya's Gemini voice speaks the
// sentence and nothing else (issue #52, the prompt-leak defect).
//
// It synthesises a fixed set of realistic sentences at every voice rate, in
// two rounds by default, transcribes each clip with gemini-3.5-transcribe and
// fails when a transcript has a word that is not in its sentence, when a clip
// trips the duration guard, or when a clip could not be checked.
//
//   node scripts/check-gemini-voice.mjs              the voice module directly (ADC)
//   node scripts/check-gemini-voice.mjs --base-url https://… --cookie-file jar.txt
//                                                    a running server's POST /api/voice
//
// Options: --rounds N (default 2), --concurrency N (default 4), --save DIR (the WAVs
// and results.json), --allow-fallback (server mode: a Kokoro clip does not fail),
// --interval-ms N (server mode: the gap between requests, default 2100 to stay
// under the api's 30 POSTs a minute),
// --transcribe-model NAME (default gemini-3.5-transcribe), --sentences FILE (one
// sentence per line instead of the fixed set). Transcription and direct
// synthesis use GOOGLE_CLOUD_PROJECT and Application Default Credentials. The
// sentences are synthetic; no employee text is sent.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGeminiVoice, geminiVoiceSettings } from '../server/gemini-voice.mjs';
import { createAccessTokenProvider, vertexGenerateContentUrl } from '../server/vertex-ai.mjs';
import { checkVoiceClip, spokenWords } from '../server/voice-guard.mjs';
import { speechText, writtenFromHeard } from '../server/speech-pronunciation.mjs';
import { voiceRates } from '../server/voice-request.mjs';

export const checkSentences = Object.freeze([
  'Yes.',
  'Welcome to your first day at UniVRse.',
  'Please arrive at Reception, Level 12, Tower B by 08:45.',
  'Your reporting manager is Kelvin Ong, who is the CTO.',
  'Casual Friday allows long jeans and clean sneakers.',
  'Use only approved AI tools.',
  'Never share your password, including with IT.',
  '1. Sign your employment contract in the HR portal.',
  'Lunch is from 12:30 to 1:30 pm, and the pantry is on Level 3.',
  'Would you like me to explain how to request annual leave?',
  'Open the full answer for the remaining details and conditions.',
  'To request annual leave,',
  'Sarah Lim from People Operations will meet you at reception and introduce you to Alya.',
  'Annual leave is 14 working days a year. Apply at least 5 working days in advance through the HR portal, so your manager can approve it before you book travel.',
  'Please feel free to reach out to HR if you need any additional assistance.',
]);

// Words a speaker may add when reading a number or a time ("oh eight", "o'clock").
const numberFillers = new Set(['oh', 'o', 'oclock', 'hundred', 'thousand', 'and']);

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// Equal, or a near spelling of a word of four letters or more: one letter
// apart, two for long words ("Sara" = "Sarah", "Universe" = "UniVRse").
function sameWord(said, heard) {
  if (said === heard) return true;
  if (said.length < 4 || heard.length < 4) return false;
  return editDistance(said, heard) <= (Math.min(said.length, heard.length) >= 7 ? 2 : 1);
}

// The sentence's spoken words, each marked when it comes from a name or an
// acronym (a capital after the first word, or two capitals: UniVRse, CTO).
function sentenceWords(sentence) {
  return String(sentence)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token, index) => {
      const name = /[A-Z]/.test(token) && (index > 0 || /[A-Z].*[A-Z]/.test(token));
      return spokenWords(token).map((word) => ({ word, name }));
    });
}

// The transcript aligned word by word with the sentence (least edits). An
// inserted word is an extra word: what a prompt leak or an invented opener
// produces. A name or acronym the transcriber spells differently ("Unify" or
// "Una VR" for UniVRse, "CTL" for CTO) is a substitution of one word by at
// most two and is reported as heard-as, not as extra. Any other substitution
// counts as an extra word; a sentence word with no counterpart is missing.
// Number fillers ("oh", "o'clock") are allowed when the sentence has digits.
export function compareTranscript(sentence, transcript) {
  const said = sentenceWords(sentence);
  // A respelled name ("Uni V R se", "Ahl-yah") counts as the written name.
  const heard = spokenWords(writtenFromHeard(transcript));
  const fillers = /\d/.test(sentence) ? numberFillers : new Set();
  const n = said.length;
  const m = heard.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const step = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i += 1)
    for (let j = 0; j <= m; j += 1) {
      const options = [];
      if (i && j && sameWord(said[i - 1].word, heard[j - 1]))
        options.push([cost[i - 1][j - 1], 'match']);
      // A name heard differently costs one edit; any other substitution costs
      // as much as a missing word plus an extra one.
      if (i && j) options.push([cost[i - 1][j - 1] + (said[i - 1].name ? 1 : 2), 'sub']);
      if (i && j > 1 && said[i - 1].name) options.push([cost[i - 1][j - 2] + 1.2, 'split']);
      if (i) options.push([cost[i - 1][j] + 1, 'missing']);
      if (j) options.push([cost[i][j - 1] + (fillers.has(heard[j - 1]) ? 0.5 : 1), 'extra']);
      for (const [value, kind] of options)
        if (value < cost[i][j]) {
          cost[i][j] = value;
          step[i][j] = kind;
        }
    }
  const extra = [];
  const missing = [];
  const heardAs = [];
  for (let i = n, j = m; i || j;) {
    const kind = step[i][j];
    if (kind === 'match') {
      i -= 1;
      j -= 1;
    } else if (kind === 'sub') {
      if (said[i - 1].name) heardAs.unshift(`${said[i - 1].word}=${heard[j - 1]}`);
      else {
        extra.unshift(heard[j - 1]);
        missing.unshift(said[i - 1].word);
      }
      i -= 1;
      j -= 1;
    } else if (kind === 'split') {
      heardAs.unshift(`${said[i - 1].word}=${heard[j - 2]} ${heard[j - 1]}`);
      i -= 1;
      j -= 2;
    } else if (kind === 'missing') {
      missing.unshift(said[i - 1].word);
      i -= 1;
    } else {
      if (!fillers.has(heard[j - 1])) extra.unshift(heard[j - 1]);
      j -= 1;
    }
  }
  return { extra, missing, heardAs };
}

// The cookie header from a curl/Netscape cookie jar or a plain "a=b; c=d" file.
export function cookieHeaderFromFile(content) {
  const lines = String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jar = lines
    .filter((line) => !line.startsWith('#') || line.startsWith('#HttpOnly_'))
    .map((line) => line.split('\t'))
    .filter((fields) => fields.length >= 7)
    .map((fields) => `${fields[5]}=${fields[6]}`);
  if (jar.length) return jar.join('; ');
  return lines.filter((line) => !line.startsWith('#')).join('; ');
}

export function parseArguments(argv) {
  const options = { rounds: 2, concurrency: 4, allowFallback: false };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${name} needs a value.`);
      return argv[++i];
    };
    if (name === '--base-url') options.baseUrl = value().replace(/\/+$/, '');
    else if (name === '--cookie-file') options.cookieFile = value();
    else if (name === '--rounds') options.rounds = Number(value());
    else if (name === '--concurrency') options.concurrency = Number(value());
    else if (name === '--save') options.save = value();
    else if (name === '--transcribe-model') options.transcribeModel = value();
    else if (name === '--sentences') options.sentencesFile = value();
    else if (name === '--allow-fallback') options.allowFallback = true;
    else if (name === '--interval-ms') options.intervalMs = Number(value());
    else throw new Error(`Unknown option ${name}.`);
  }
  if (!Number.isInteger(options.rounds) || options.rounds < 1)
    throw new Error('--rounds must be 1 or more.');
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1)
    throw new Error('--concurrency must be 1 or more.');
  if (options.baseUrl && !options.cookieFile)
    throw new Error('--base-url needs --cookie-file (a signed-in session).');
  return options;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Retries rate limits and server errors; anything else fails at once.
async function withRetry(work, tries = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const status = error?.status ?? null;
      const transient =
        status === 429 ||
        (status >= 500 && status < 600) ||
        ['TIMEOUT', 'UNREACHABLE'].includes(error?.code);
      if (!transient || attempt >= tries) throw error;
      // The api allows 30 POSTs a minute per address; a 429 waits for the window.
      await sleep(status === 429 ? 20000 : 1500 * 2 ** (attempt - 1));
    }
  }
}

export function transcriber({ project, model, getAccessToken }) {
  const url = vertexGenerateContentUrl({ project, location: 'global', model });
  return async (wav) =>
    withRetry(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await getAccessToken()}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }],
            },
          ],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw Object.assign(new Error(`Transcription failed (HTTP ${response.status}).`), {
          status: response.status,
        });
      }
      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return parts
        .map((part) => part?.audioTranscription?.text ?? part?.text ?? '')
        .join(' ')
        .trim();
    });
}

function serverVoice({ baseUrl, cookie, intervalMs }) {
  // Requests start at least intervalMs apart, under the api's POST limit.
  let next = 0;
  const slot = async () => {
    const now = Date.now();
    const start = Math.max(now, next);
    next = start + intervalMs;
    await sleep(start - now);
  };
  return async (text, rate) =>
    withRetry(async () => {
      await slot();
      const response = await fetch(`${baseUrl}/api/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ text, rate }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Object.assign(
          new Error(`POST /api/voice answered ${response.status} ${body.code || ''}`.trim()),
          { status: response.status },
        );
      }
      return {
        wav: Buffer.from(await response.arrayBuffer()),
        voice: response.headers.get('x-alya-voice') || 'unknown',
      };
    });
}

async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}

const seconds = (value) => (Number.isFinite(value) ? value.toFixed(2) : '-');

export function formatTable(rows) {
  const header = [
    '#',
    'round',
    'rate',
    'voice',
    'ms',
    'clip s',
    'max s',
    'guard',
    'extra words',
    'heard as / missing',
    'transcript',
  ];
  const lines = rows.map((row) => [
    String(row.index + 1),
    String(row.round),
    String(row.rate),
    row.voice,
    String(row.ms),
    seconds(row.durationSeconds),
    seconds(row.maxSeconds),
    row.error ? 'ERROR' : row.guardOk === null ? 'n/a' : row.guardOk ? 'pass' : 'TRIP',
    row.error ? row.error : row.extra.length ? row.extra.join(' ') : '-',
    [...(row.heardAs || []), ...(row.missing || []).map((word) => `-${word}`)].join(', ') || '-',
    (row.transcript || '').slice(0, 60),
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column].length)),
  );
  const format = (cells) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd();
  return [
    format(header),
    format(widths.map((width) => '-'.repeat(width))),
    ...lines.map(format),
  ].join('\n');
}

export function summarise(rows, { allowFallback = false } = {}) {
  const leaks = rows.filter((row) => !row.error && row.extra.length);
  const trips = rows.filter((row) => row.guardOk === false);
  const errors = rows.filter((row) => row.error);
  const fallbacks = rows.filter((row) => !row.error && !row.voice.startsWith('gemini-'));
  const incomplete = rows.filter((row) => !row.error && row.missing.length);
  const namesHeardAs = rows.filter((row) => !row.error && row.heardAs?.length);
  const failed =
    leaks.length > 0 ||
    trips.length > 0 ||
    errors.length > 0 ||
    (!allowFallback && fallbacks.length > 0);
  return {
    clips: rows.length,
    leaks: leaks.length,
    guardTrips: trips.length,
    errors: errors.length,
    fallbacks: fallbacks.length,
    clipsMissingWords: incomplete.length,
    clipsWithNamesHeardAs: namesHeardAs.length,
    failed,
  };
}

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const options = parseArguments(process.argv.slice(2));
  const project = (process.env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (!project) {
    console.error(
      'GOOGLE_CLOUD_PROJECT is not set: add it to .env (transcription needs Vertex AI).',
    );
    process.exitCode = 2;
    return;
  }
  const getAccessToken = createAccessTokenProvider();
  const transcribe = transcriber({
    project,
    model: options.transcribeModel || 'gemini-3.5-transcribe',
    getAccessToken,
  });

  let speak;
  let target;
  if (options.baseUrl) {
    const cookie = cookieHeaderFromFile(readFileSync(resolve(options.cookieFile), 'utf8'));
    speak = serverVoice({
      baseUrl: options.baseUrl,
      cookie,
      intervalMs: options.intervalMs ?? 2100,
    });
    target = `${options.baseUrl}/api/voice`;
  } else {
    const settings = geminiVoiceSettings({ ...process.env, VOICE_PROVIDER: 'gemini' });
    const gemini = createGeminiVoice({ ...settings, getAccessToken, log: () => {} });
    speak = async (text) => ({
      // The text /api/voice would send: the names respelled for speech.
      wav: await withRetry(() => gemini.synthesizeOnce(speechText(text))),
      voice: gemini.header,
    });
    target = `${settings.model} at ${settings.location}, voice ${settings.voice} (direct)`;
  }

  const sentences = options.sentencesFile
    ? readFileSync(resolve(options.sentencesFile), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    : checkSentences;
  const jobs = [];
  for (let round = 1; round <= options.rounds; round += 1)
    for (const rate of voiceRates)
      for (const sentence of sentences) jobs.push({ round, rate, sentence });
  console.log(`Voice check: ${jobs.length} clips through ${target}`);
  if (options.save) mkdirSync(options.save, { recursive: true });

  const rows = await pool(jobs, options.concurrency, async (job, index) => {
    const row = {
      index,
      ...job,
      voice: '-',
      ms: 0,
      extra: [],
      missing: [],
      heardAs: [],
      guardOk: null,
    };
    const started = Date.now();
    try {
      const { wav, voice } = await speak(job.sentence, job.rate);
      row.ms = Date.now() - started;
      row.voice = voice;
      // The guard measures the respelled text, as the api does.
      const check = checkVoiceClip(wav, speechText(job.sentence));
      row.durationSeconds = check.durationSeconds;
      row.expectedSeconds = check.expectedSeconds;
      row.maxSeconds = check.maxSeconds;
      // The guard is calibrated for Gemini; a Kokoro fallback is reported apart.
      row.guardOk = voice.startsWith('gemini-') ? check.ok : null;
      row.transcript = await transcribe(wav);
      Object.assign(row, compareTranscript(job.sentence, row.transcript));
      if (options.save)
        writeFileSync(
          join(options.save, `${String(index + 1).padStart(3, '0')}-r${job.round}-${job.rate}.wav`),
          wav,
        );
    } catch (error) {
      row.ms = row.ms || Date.now() - started;
      row.error = String(error?.message || error).slice(0, 80);
    }
    return row;
  });

  console.log(formatTable(rows));
  const summary = summarise(rows, options);
  console.log(JSON.stringify(summary));
  if (options.save)
    writeFileSync(
      join(options.save, 'results.json'),
      JSON.stringify({ target, summary, rows }, null, 2) + '\n',
    );
  console.log(summary.failed ? 'FAIL' : 'PASS');
  process.exitCode = summary.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  });
}
