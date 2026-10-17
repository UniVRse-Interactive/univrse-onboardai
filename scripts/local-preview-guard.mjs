// This opt-in entry point is never imported by production servers.
const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const peers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function assertLocalPreview(env, argv = process.argv) {
  if (
    env.NODE_ENV !== 'development' ||
    env.K_SERVICE ||
    env.CLOUD_RUN_JOB ||
    env.K_REVISION ||
    argv.includes('--production') ||
    (env.HOST && !hosts.has(env.HOST))
  ) {
    throw new Error(
      'Local preview requires development mode and a loopback host; production/cloud runs are forbidden.',
    );
  }
}

export function localPreviewRequest(req) {
  if (!peers.has(req.socket.remoteAddress)) return false;
  if (req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'])
    return false;
  try {
    const target = new URL(`http://${req.headers.host}`);
    if (!hosts.has(target.hostname)) return false;
    for (const key of ['origin', 'referer']) {
      if (req.headers[key] && new URL(req.headers[key]).origin !== target.origin) return false;
    }
    return true;
  } catch {
    return false;
  }
}
