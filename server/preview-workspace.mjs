import { randomUUID } from 'node:crypto';
import { ChatError } from './saved-conversations.mjs';

const fail = (status, message) => {
  throw new ChatError(status, 'WORKSPACE_REQUEST_INVALID', message);
};
const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
export const employeeOwner = (id) => 'employee:' + id;

// Browser-scoped preview records, not employee authentication or verified HR.
// UUID ownership never depends on editable employee codes or display numbering.
export function createPreviewWorkspace(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS preview_employees (
    id TEXT PRIMARY KEY, workspace TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
    guest INTEGER NOT NULL, created INTEGER NOT NULL, UNIQUE(workspace,code)
  ); CREATE TABLE IF NOT EXISTS preview_access (
    workspace TEXT PRIMARY KEY, role TEXT NOT NULL, employee_id TEXT
  ); CREATE TABLE IF NOT EXISTS uploaded_guidance (
    id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL
  );`);
  const employees = (workspace) =>
    db
      .prepare(
        'SELECT id,code,name,guest,created FROM preview_employees WHERE workspace=? ORDER BY created,id',
      )
      .all(workspace);
  function current(workspace) {
    const row = db
      .prepare('SELECT role,employee_id FROM preview_access WHERE workspace=?')
      .get(workspace);
    const employee = row?.employee_id
      ? db
          .prepare('SELECT id,code,name,guest FROM preview_employees WHERE id=? AND workspace=?')
          .get(row.employee_id, workspace)
      : null;
    return {
      role: row?.role === 'hr' ? 'hr' : employee ? 'employee' : null,
      employee: employee || null,
      preview: true,
    };
  }
  function add(workspace, input) {
    if (employees(workspace).length >= 100)
      fail(409, 'This preview supports up to 100 employee profiles.');
    const id = randomUUID(),
      guest = input.guest === true;
    const name = clean(input.name, 80) || (guest ? 'Guest employee' : '');
    const code = guest ? 'GUEST-' + id.slice(0, 8) : clean(input.employeeId, 40);
    if (!name || !/^[\w.-]{1,40}$/.test(code))
      fail(
        400,
        'Enter a name and an employee ID using letters, numbers, dots, hyphens or underscores.',
      );
    if (
      db
        .prepare('SELECT id FROM preview_employees WHERE workspace=? AND code=?')
        .get(workspace, code)
    )
      fail(
        409,
        'That employee ID already exists in this preview. Choose Employee access to reopen it.',
      );
    db.prepare('INSERT INTO preview_employees VALUES(?,?,?,?,?,?)').run(
      id,
      workspace,
      code,
      name,
      Number(guest),
      Date.now(),
    );
    return employees(workspace).find((e) => e.id === id);
  }
  function enter(workspace, input) {
    let employee = null;
    if (input.role === 'employee') {
      if (input.action === 'signup' || input.action === 'guest')
        employee = add(workspace, { ...input, guest: input.action === 'guest' });
      else if (input.action === 'select')
        employee = employees(workspace).find((e) => e.code === clean(input.employeeId, 40));
      if (!employee)
        fail(
          404,
          'No matching employee profile in this browser preview. Create one or continue as a guest.',
        );
    } else if (input.role !== 'hr') fail(400, 'Choose Employee or HR preview access.');
    db.prepare(
      'INSERT INTO preview_access VALUES(?,?,?) ON CONFLICT(workspace) DO UPDATE SET role=excluded.role,employee_id=excluded.employee_id',
    ).run(workspace, input.role, employee?.id || null);
    return current(workspace);
  }
  function requireHr(workspace) {
    if (current(workspace).role !== 'hr')
      fail(403, 'Open HR preview access to manage this workspace.');
  }
  function upload(workspace, input) {
    const name = clean(input.name, 120),
      text = typeof input.text === 'string' ? input.text : '';
    const bytes = Buffer.byteLength(text, 'utf8');
    if (!/\.(txt|md)$/i.test(name) || /[/\\]/.test(name))
      fail(400, 'Upload a plain-text .txt or Markdown .md file.');
    if (
      !text.trim() ||
      bytes > 100000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text)
    )
      fail(400, 'Use a non-empty UTF-8 text file up to 100 KB, without binary content.');
    const docs = documents(workspace);
    if (docs.length >= 10 || docs.reduce((n, d) => n + d.text.length, 0) + text.length > 120000)
      fail(400, 'This preview supports 10 uploads and 120,000 characters of uploaded guidance.');
    const id = randomUUID();
    db.prepare('INSERT INTO uploaded_guidance VALUES(?,?,?,?,?,?)').run(
      id,
      workspace,
      name,
      text.trim(),
      bytes,
      Date.now(),
    );
    return id;
  }
  const documents = (workspace) =>
    db
      .prepare('SELECT * FROM uploaded_guidance WHERE workspace=? ORDER BY created,id')
      .all(workspace);
  function documentsForOwner(owner) {
    const workspace = owner?.startsWith('employee:')
      ? db.prepare('SELECT workspace FROM preview_employees WHERE id=?').get(owner.slice(9))
          ?.workspace
      : owner;
    return workspace
      ? documents(workspace).map((d) => ({ title: 'Uploaded: ' + d.name, text: d.text }))
      : [];
  }
  const removeEmployee = db.transaction((workspace, id, memory) => {
    if (!employees(workspace).some((e) => e.id === id))
      fail(404, 'Employee not found in this preview.');
    for (const chat of memory.list(employeeOwner(id))) memory.erase(employeeOwner(id), chat.id);
    db.prepare('DELETE FROM preview_employees WHERE id=? AND workspace=?').run(id, workspace);
    db.prepare('DELETE FROM preview_access WHERE employee_id=?').run(id);
  });
  return {
    current,
    employees,
    enter,
    add,
    requireHr,
    upload,
    documents,
    documentsForOwner,
    removeEmployee,
    leave(workspace) {
      db.prepare('DELETE FROM preview_access WHERE workspace=?').run(workspace);
    },
    removeDocument(workspace, id) {
      if (
        !db.prepare('DELETE FROM uploaded_guidance WHERE workspace=? AND id=?').run(workspace, id)
          .changes
      )
        fail(404, 'Document not found in this preview.');
    },
  };
}

export function attachWorkspaceRoutes(app, { session, workspace, memory, onError }) {
  const route = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (error) {
      onError(res, error);
    }
  };
  const hr = (req, res, next) => {
    try {
      workspace().requireHr(req.workspaceOwner);
      next();
    } catch (error) {
      onError(res, error);
    }
  };
  app.get(
    '/api/access',
    session,
    route((req, res) =>
      res.json({
        ...workspace().current(req.workspaceOwner),
        employees: workspace().employees(req.workspaceOwner),
      }),
    ),
  );
  app.post(
    '/api/access',
    session,
    route((req, res) => res.json(workspace().enter(req.workspaceOwner, req.body || {}))),
  );
  app.delete(
    '/api/access',
    session,
    route((req, res) => {
      workspace().leave(req.workspaceOwner);
      res.sendStatus(204);
    }),
  );
  app.get(
    '/api/hr/workspace',
    session,
    hr,
    route((req, res) => {
      const employees = workspace()
        .employees(req.workspaceOwner)
        .map((e) => {
          const s = memory().supportSummary(employeeOwner(e.id));
          return {
            ...e,
            summary: {
              turns: s.turns,
              requests: s.requests,
              feedback: s.feedback,
              humanHelpRequests: s.humanHelpRequests,
              overview: s.overview,
            },
          };
        });
      res.json({
        preview: true,
        employees,
        documents: workspace()
          .documents(req.workspaceOwner)
          .map(({ text, workspace, ...d }) => d),
        totals: {
          employees: employees.length,
          answers: employees.reduce((n, e) => n + e.summary.turns, 0),
          humanHelpRequests: employees.reduce((n, e) => n + e.summary.humanHelpRequests, 0),
        },
      });
    }),
  );
  app.post(
    '/api/hr/employees',
    session,
    hr,
    route((req, res) => res.status(201).json(workspace().add(req.workspaceOwner, req.body || {}))),
  );
  app.delete(
    '/api/hr/employees/:id',
    session,
    hr,
    route((req, res) => {
      workspace().removeEmployee(req.workspaceOwner, req.params.id, memory());
      res.sendStatus(204);
    }),
  );
  app.post(
    '/api/hr/documents',
    session,
    hr,
    route((req, res) =>
      res.status(201).json({ id: workspace().upload(req.workspaceOwner, req.body || {}) }),
    ),
  );
  app.delete(
    '/api/hr/documents/:id',
    session,
    hr,
    route((req, res) => {
      workspace().removeDocument(req.workspaceOwner, req.params.id);
      res.sendStatus(204);
    }),
  );
}
