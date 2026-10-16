import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commands,
  ensureDocker,
  missingProjectMessage,
  placeholderFile,
  renderSummary,
  resolveAdcFile,
  resolveProject,
  runLocal,
} from '../../scripts/local-stack.mjs';

// A fake runner: docker info answers according to `daemon`, which a test can
// flip (as if Docker Desktop finished starting). Every call is recorded.
function fakeRun({ daemon = { up: true }, fail = [], missing = false, gcloud = null } = {}) {
  const calls = [];
  const envs = [];
  const run = (command, args, options = {}) => {
    envs.push(options.env);
    calls.push([command, ...args].join(' '));
    if (command === 'docker' && args[0] === 'info')
      return { status: daemon.up ? 0 : 1, stdout: '' };
    if (args[0] === 'image') return { status: missing ? 1 : 0, stdout: '' };
    if (command === 'open') return { status: daemon.openFails ? 1 : 0, stdout: '' };
    if (command === 'gcloud')
      return gcloud === null ? { status: 127, stdout: '' } : { status: 0, stdout: gcloud };
    return { status: fail.includes(args[1]) ? 1 : 0, stdout: '' };
  };
  return { run, calls, daemon, envs };
}

// Keeps tests off the real home directory, file system, .env and gcloud.
const projectStub = { env: { GOOGLE_CLOUD_PROJECT: 'synthetic-project' }, dotEnv: () => ({}) };
const adcStub = {
  adcOptions: { env: {}, home: '/h', exists: () => true, writeText: async () => {} },
  projectOptions: projectStub,
};

const login = {
  hrId: 'HR-0001',
  password: 'abcde-fghjk-mnpqr-stuvw',
  appUrl: 'http://localhost:3100',
  emulatorUiUrl: 'http://localhost:4000',
};

test('a running Docker needs no start-up on any platform', async () => {
  const { run, calls } = fakeRun();
  assert.deepEqual(await ensureDocker({ run, platform: 'darwin' }), { ok: true });
  assert.deepEqual(calls, ['docker info']);
});

test('on macOS a stopped Docker is opened and polled until it answers', async () => {
  const f = fakeRun({ daemon: { up: false } });
  let clock = 0,
    sleeps = 0;
  const result = await ensureDocker({
    run: f.run,
    platform: 'darwin',
    log: () => {},
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      if (++sleeps === 3) f.daemon.up = true;
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.ok(f.calls.includes('open -a Docker'));
  assert.equal(sleeps, 3);
});

test('on macOS it gives up after 120 s with a clear message', async () => {
  const f = fakeRun({ daemon: { up: false } });
  let clock = 0;
  const result = await ensureDocker({
    run: f.run,
    platform: 'darwin',
    log: () => {},
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /within 120 s/);
  assert.ok(clock >= 120000);
});

test('on other platforms it does not try to start Docker', async () => {
  for (const platform of ['linux', 'win32']) {
    const f = fakeRun({ daemon: { up: false } });
    const result = await ensureDocker({ run: f.run, platform });
    assert.equal(result.ok, false);
    assert.match(result.message, /Start Docker/);
    assert.deepEqual(f.calls, ['docker info']);
  }
  const f = fakeRun({ daemon: { up: false, openFails: true } });
  const result = await ensureDocker({ run: f.run, platform: 'darwin', log: () => {} });
  assert.match(result.message, /Could not start Docker Desktop/);
});

test('start builds, brings up web and prints the login summary', async () => {
  const f = fakeRun();
  const out = [];
  const made = [];
  const { exitCode } = await runLocal('start', {
    ...adcStub,
    run: f.run,
    platform: 'linux',
    mkdirp: async (path) => made.push(path),
    read: async () => JSON.stringify(login),
    out: (line) => out.push(line),
    err: () => assert.fail('no error expected'),
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(f.calls, [
    'docker info',
    'docker image inspect onboardai-local-firebase-emulator:15.34.0',
    'docker compose build',
    'docker compose up -d --wait web',
  ]);
  assert.deepEqual(made, ['.cache/local-stack']);
  const text = out.join('\n');
  for (const expected of [
    'http://localhost:3100',
    'HR-0001',
    'abcde-fghjk-mnpqr-stuvw',
    'http://localhost:4000',
    '127.0.0.1:5442',
    'npm run local:down',
    'npm run local:logs',
  ])
    assert.ok(text.includes(expected), expected);
});

test('without a stored password the summary shows the reset hint instead', async () => {
  const f = fakeRun();
  const out = [];
  await runLocal('start', {
    ...adcStub,
    run: f.run,
    platform: 'linux',
    mkdirp: async () => {},
    read: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    out: (line) => out.push(line),
  });
  const text = out.join('\n');
  assert.match(text, /npm run local:reset-hr/);
  assert.doesNotMatch(text, /HR password {2}/);
  assert.match(renderSummary(null), /not stored/);
});

test('reset runs the setup service with LOCAL_HR_RESET=1 and prints the summary', async () => {
  const f = fakeRun();
  const out = [];
  const { exitCode } = await runLocal('reset', {
    ...adcStub,
    run: f.run,
    platform: 'linux',
    mkdirp: async () => {},
    read: async () => JSON.stringify(login),
    out: (line) => out.push(line),
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(f.calls, ['docker info', 'docker compose run --rm -e LOCAL_HR_RESET=1 setup']);
  assert.ok(out.join('\n').includes('abcde-fghjk-mnpqr-stuvw'));
});

test('down stops only web, api, tts and the checklist agent; logs follows them; neither removes anything', async () => {
  const f = fakeRun();
  const out = [];
  assert.equal(
    (await runLocal('down', { ...adcStub, run: f.run, platform: 'linux', out: (l) => out.push(l) }))
      .exitCode,
    0,
  );
  assert.equal((await runLocal('logs', { ...adcStub, run: f.run, platform: 'linux' })).exitCode, 0);
  assert.deepEqual(f.calls, [
    'docker info',
    'docker compose stop web api tts checklist-agent',
    'docker info',
    'docker compose logs -f web api tts checklist-agent setup',
  ]);
  for (const args of Object.values(commands)) {
    assert.ok(!args.includes('down'));
    assert.ok(!args.includes('-v'));
  }
});

test('failures exit non-zero with a short message and a logs hint', async () => {
  const errors = [];
  const base = {
    ...adcStub,
    platform: 'linux',
    mkdirp: async () => {},
    read: async () => '{}',
    out: () => {},
  };
  let f = fakeRun({ fail: ['up'] });
  let result = await runLocal('start', {
    ...adcStub,
    ...base,
    run: f.run,
    err: (l) => errors.push(l),
  });
  assert.equal(result.exitCode, 1);
  assert.match(errors.at(-1), /npm run local:logs/);

  f = fakeRun({ fail: ['build'], missing: false });
  result = await runLocal('start', { ...adcStub, ...base, run: f.run, err: (l) => errors.push(l) });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(f.calls.slice(-1), ['docker compose build']);

  f = fakeRun({ daemon: { up: false } });
  result = await runLocal('start', { ...adcStub, ...base, run: f.run, err: (l) => errors.push(l) });
  assert.equal(result.exitCode, 1);
  assert.equal(
    (await runLocal('bogus', { ...base, ...adcStub, run: f.run, err: () => {} })).exitCode,
    1,
  );
});

test('the credentials file is found, preferred from GOOGLE_APPLICATION_CREDENTIALS, or a placeholder', async () => {
  const wrote = [];
  const writeText = async (path, text) => wrote.push([path, text]);
  const home = '/home/u';
  const fallback = '/home/u/.config/gcloud/application_default_credentials.json';
  assert.deepEqual(
    await resolveAdcFile({ env: {}, home, exists: (p) => p === fallback, writeText }),
    { file: fallback, found: true },
  );
  assert.deepEqual(
    await resolveAdcFile({
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/keys/mine.json' },
      home,
      exists: () => true,
      writeText,
    }),
    { file: '/keys/mine.json', found: true },
  );
  // A configured path that does not exist falls back to the gcloud login.
  assert.equal(
    (
      await resolveAdcFile({
        env: { GOOGLE_APPLICATION_CREDENTIALS: '/keys/gone.json' },
        home,
        exists: (p) => p === fallback,
        writeText,
      })
    ).file,
    fallback,
  );
  assert.deepEqual(wrote, []);
  const missing = await resolveAdcFile({ env: {}, home, exists: () => false, writeText });
  assert.deepEqual(missing, { file: placeholderFile, found: false });
  assert.ok(placeholderFile.startsWith('/') && placeholderFile.endsWith('no-adc.json'));
  assert.deepEqual(wrote, [[placeholderFile, '{}\n']]);
});

test('every compose call gets LOCAL_ADC_FILE, and the summary reports Gemini autofill', async () => {
  for (const [found, expected] of [
    [true, /Gemini autofill\s+on/],
    [
      false,
      /Gemini autofill\s+off \(no Google login\)[\s\S]*gcloud auth application-default login/,
    ],
  ]) {
    for (const command of ['start', 'reset', 'down', 'logs']) {
      const f = fakeRun();
      const out = [];
      await runLocal(command, {
        run: f.run,
        platform: 'linux',
        mkdirp: async () => {},
        read: async () => JSON.stringify(login),
        out: (l) => out.push(l),
        adcOptions: { env: {}, home: '/h', exists: () => found, writeText: async () => {} },
        projectOptions: projectStub,
      });
      const composeEnvs = f.calls
        .map((call, i) => [call, f.envs[i]])
        .filter(([call]) => call.startsWith('docker compose'))
        .map(([, env]) => env);
      assert.ok(composeEnvs.length >= 1);
      for (const env of composeEnvs)
        assert.equal(
          env.LOCAL_ADC_FILE,
          found ? '/h/.config/gcloud/application_default_credentials.json' : placeholderFile,
        );
      if (command === 'start' || command === 'reset') assert.match(out.join('\n'), expected);
    }
  }
});

test('the emulator image is built once, before up, only when it is missing', async () => {
  const base = {
    ...adcStub,
    platform: 'linux',
    mkdirp: async () => {},
    read: async () => '{}',
    out: () => {},
  };
  const present = fakeRun();
  await runLocal('start', { ...base, run: present.run });
  assert.ok(!present.calls.some((c) => c.includes('firebase-emulator-image')));

  const missing = fakeRun({ missing: true });
  await runLocal('start', { ...base, run: missing.run });
  assert.deepEqual(missing.calls, [
    'docker info',
    'docker image inspect onboardai-local-firebase-emulator:15.34.0',
    'docker compose --profile emulator-image build firebase-emulator-image',
    'docker compose build',
    'docker compose up -d --wait web',
  ]);
  assert.ok(missing.envs.slice(1).every((env) => env.LOCAL_ADC_FILE));

  const broken = fakeRun({ missing: true, fail: ['--profile'] });
  const errors = [];
  const result = await runLocal('start', { ...base, run: broken.run, err: (l) => errors.push(l) });
  assert.equal(result.exitCode, 1);
  assert.ok(!broken.calls.includes('docker compose build'));
});

test('the summary App line uses the current web port, not the stored URL', () => {
  const text = renderSummary(login, { webPort: '3150' });
  assert.match(text, /App\s+http:\/\/localhost:3150/);
  assert.ok(!text.includes('http://localhost:3100'));
  assert.match(renderSummary(null, { webPort: '3150' }), /App\s+http:\/\/localhost:3150/);
});

test('GOOGLE_CLOUD_PROJECT comes from the environment, then .env, then gcloud', () => {
  const never = () => assert.fail('not asked');
  assert.deepEqual(
    resolveProject({ env: { GOOGLE_CLOUD_PROJECT: ' from-env ' }, dotEnv: never, run: never }),
    { project: 'from-env', source: 'environment' },
  );
  assert.deepEqual(
    resolveProject({
      env: {},
      dotEnv: () => ({ GOOGLE_CLOUD_PROJECT: 'from-dotenv' }),
      run: never,
    }),
    { project: 'from-dotenv', source: '.env' },
  );
  const f = fakeRun({ gcloud: 'from-gcloud\n' });
  assert.deepEqual(
    resolveProject({ env: { GOOGLE_CLOUD_PROJECT: '' }, dotEnv: () => ({}), run: f.run }),
    {
      project: 'from-gcloud',
      source: 'gcloud',
    },
  );
  assert.deepEqual(f.calls, ['gcloud config get-value project']);
  // gcloud with no project set, gcloud not installed, an unreadable .env.
  for (const run of [fakeRun({ gcloud: '(unset)\n' }).run, fakeRun().run])
    assert.deepEqual(
      resolveProject({
        env: {},
        dotEnv: () => {
          throw new Error('unreadable');
        },
        run,
      }),
      { project: null, source: null },
    );
});

test('start passes the project to every compose call, or stops before building without one', async () => {
  const base = {
    adcOptions: adcStub.adcOptions,
    platform: 'linux',
    mkdirp: async () => {},
    read: async () => JSON.stringify(login),
  };
  // A checkout without .env, with the project only in gcloud's config.
  const f = fakeRun({ gcloud: 'gcloud-project\n' });
  const out = [];
  const started = await runLocal('start', {
    ...base,
    run: f.run,
    projectOptions: { env: {}, dotEnv: () => ({}) },
    out: (l) => out.push(l),
    err: () => assert.fail('no error expected'),
  });
  assert.equal(started.exitCode, 0);
  assert.ok(out.includes('Gemini project: gcloud-project (from gcloud).'));
  const composeEnvs = f.calls
    .map((call, i) => [call, f.envs[i]])
    .filter(([call]) => call.startsWith('docker compose'))
    .map(([, env]) => env);
  assert.equal(composeEnvs.length, 2);
  assert.ok(composeEnvs.every((env) => env.GOOGLE_CLOUD_PROJECT === 'gcloud-project'));

  // Nowhere: a clear message, and nothing is built or started.
  const none = fakeRun({ gcloud: '' });
  const errors = [];
  const stopped = await runLocal('start', {
    ...base,
    run: none.run,
    projectOptions: { env: {}, dotEnv: () => ({}) },
    out: () => {},
    err: (l) => errors.push(l),
  });
  assert.equal(stopped.exitCode, 1);
  assert.deepEqual(errors, [missingProjectMessage]);
  assert.equal(
    missingProjectMessage,
    'GOOGLE_CLOUD_PROJECT is not set: add it to .env (Gemini on Vertex AI needs it)',
  );
  assert.ok(!none.calls.some((call) => call.startsWith('docker compose')));
  // down, logs and reset do not need a project.
  for (const command of ['down', 'logs', 'reset'])
    assert.equal(
      (
        await runLocal(command, {
          ...base,
          run: fakeRun({ gcloud: '' }).run,
          projectOptions: { env: {}, dotEnv: () => ({}) },
          out: () => {},
        })
      ).exitCode,
      0,
      command,
    );
});
