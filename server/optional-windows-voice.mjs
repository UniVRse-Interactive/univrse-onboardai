import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { speechTimeline } from './windows-audio-mouth-timing.mjs';

export async function createWindowsVoice() {
  if (process.platform !== 'win32') return null;
  const child = spawn(
    process.env.ONBOARDAI_POWERSHELL || 'pwsh.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('../scripts/start-windows-voice-helper.ps1', import.meta.url)),
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const pending = new Map();
  let nextId = 0,
    voiceName = '',
    closed = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const startup = setTimeout(() => {
    child.kill();
    readyReject(new Error('Windows voice startup timed out.'));
  }, 15000);
  function failed(error) {
    closed = true;
    clearTimeout(startup);
    readyReject(error);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }
  child.on('error', () => failed(new Error('Windows voice helper could not start.')));
  child.on('exit', () =>
    failed(new Error('Windows voice helper stopped. Restart the preview server.')),
  );
  child.stderr.on('data', () => {});
  createInterface({ input: child.stdout }).on('line', (line) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    if ('ready' in data) {
      clearTimeout(startup);
      if (data.ready) {
        voiceName = data.voice;
        readyResolve();
      } else {
        readyReject(new Error(data.error || 'Windows voice unavailable.'));
        child.kill();
      }
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(data.error));
    else
      try {
        entry.resolve(speechTimeline(data.result));
      } catch (error) {
        entry.reject(error);
      }
  });
  try {
    await ready;
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    name: voiceName,
    render(text, rate = 0.95) {
      if (closed)
        return Promise.reject(
          new Error('Windows voice helper stopped. Restart the preview server.'),
        );
      if (pending.size >= 4)
        return Promise.reject(new Error('Voice is busy. Please try again in a moment.'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Windows voice took too long. Please try again.'));
        }, 25000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, text, rate }) + '\n', (error) => {
          if (error) {
            pending.delete(id);
            clearTimeout(timer);
            reject(new Error('Windows voice helper could not receive the answer.'));
          }
        });
      });
    },
    close() {
      child.kill();
    },
  };
}
