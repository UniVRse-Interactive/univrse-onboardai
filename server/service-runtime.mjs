import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

// Shared start-up for the Cloud Run entry points: listen on HOST:PORT and stop
// cleanly on SIGTERM (Cloud Run sends it before shutting an instance down).
export function loadEnvFile() {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export function parseTrustProxy(value, fallback) {
  const raw = value ?? fallback;
  if (raw === undefined || raw === '') return false;
  if (/^\d+$/.test(String(raw))) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return String(raw);
}

export function startService(app, { name, onClose }) {
  const server = createServer(app);
  const port = Number(process.env.PORT) || 8080;
  server.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log(`${name} ready on port ${port}`),
  );
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 4000);
    deadline.unref();
    await new Promise((resolve) => server.close(resolve));
    onClose?.();
    clearTimeout(deadline);
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}
