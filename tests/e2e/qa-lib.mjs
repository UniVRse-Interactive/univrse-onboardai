// Small helper for the QA scripts: a cookie-keeping JSON client.
// The API allows 30 POSTs a minute per client, so mutating calls are spaced
// 2.2 s apart (shared by every client in the process).
let lastWrite = 0;
const pace = async () => {
  const wait = lastWrite + 2200 - Date.now();
  lastWrite = Math.max(Date.now(), lastWrite) + (wait > 0 ? wait : 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
};

export function client(base = process.env.BASE_URL || 'http://localhost:3130') {
  let cookie = '';
  const call = async (method, path, body) => {
    if (method !== 'GET') await pace();
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) cookie = c.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  };
  return {
    call,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
  };
}

// Asks Alya one question in a saved conversation (creates one when needed).
export async function ask(c, question, { conversationId, quickQuestionId, reexplainOf } = {}) {
  let id = conversationId;
  if (!id) {
    const made = await c.post('/api/conversations');
    if (made.status !== 201) throw new Error(`conversation ${made.status} ${made.text}`);
    id = made.json.id ?? made.json.conversation?.id;
  }
  const res = await c.post('/api/chat', {
    question,
    taskId: 'company-resources',
    style: 'simple',
    conversationId: id,
    requestId: crypto.randomUUID(),
    ...(quickQuestionId ? { quickQuestionId } : {}),
    ...(reexplainOf ? { reexplainOf } : {}),
  });
  return { conversationId: id, ...res };
}
