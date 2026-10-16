import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { accountApi } from './account-api.mjs';
import { TextField } from './account-fields';
import { ErrorSummary, Panel } from './HrEmployees';
import { ScreenHeading } from './HrScreenParts';
import { departmentCache, useDepartments } from './use-departments';
import {
  addedMessage,
  archiveNote,
  archivedMessage,
  editNotes,
  employeesLabel,
  hasChanges,
  normalizePrefix,
  patchBody,
  prefixPreview,
  restoreNote,
  savedMessage,
  serverDepartmentErrors,
  statusLabel,
  validateDepartmentForm,
} from './department-settings.mjs';
import './accounts.css';
import './hr-settings.css';

// Name + Prefix inputs for adding or editing a department.
function DepartmentForm({ idPrefix, department, departments, onSubmit, onClose, submitLabel }) {
  const [form, setForm] = useState({
    name: department?.name ?? '',
    prefix: department?.prefix ?? '',
  });
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null),
    summaryRef = useRef(null),
    alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const ignoreId = department?.id ?? '';
  const clientErrors = validateDepartmentForm(form, departments, ignoreId);
  const shown = (field) => serverErrors[field] || (touched[field] ? clientErrors[field] : '');
  const notes = department ? editNotes(department, form) : {};
  function change(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: field === 'prefix' ? normalizePrefix(value) : value,
    }));
    setTouched((previous) => ({ ...previous, [field]: true }));
    setServerErrors((previous) => ({ ...previous, [field]: '' }));
  }
  function focusProblem() {
    requestAnimationFrame(() => {
      const invalid = formRef.current?.querySelector('[aria-invalid="true"]');
      (invalid || summaryRef.current)?.focus();
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setSummary('');
    if (Object.keys(clientErrors).length) {
      setTouched({ name: true, prefix: true });
      focusProblem();
      return;
    }
    setBusy(true);
    try {
      await onSubmit(form);
    } catch (error) {
      if (!alive.current) return;
      const { errors, summary: message } = serverDepartmentErrors(error);
      setServerErrors(errors);
      setSummary(message);
      focusProblem();
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const unchanged = department && !hasChanges(department, form);
  return (
    <form className="account-form" onSubmit={submit} ref={formRef} noValidate>
      <div className="account-group-fields">
        <TextField
          id={idPrefix + '-name'}
          label="Name"
          required
          maxLength={80}
          value={form.name}
          onChange={(value) => change('name', value)}
          error={shown('name')}
          note={notes.name}
        />
        <TextField
          id={idPrefix + '-prefix'}
          label="Prefix"
          required
          maxLength={4}
          value={form.prefix}
          onChange={(value) => change('prefix', value)}
          error={shown('prefix')}
          hint={prefixPreview(form.prefix)}
          note={notes.prefix}
        />
      </div>
      <ErrorSummary message={summary} summaryRef={summaryRef} />
      <div className="account-actions">
        <button className="account-primary" type="submit" disabled={busy || unchanged}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="account-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ArchivePanel({ department, onClose, onDone }) {
  const archiving = !department.archived;
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  async function confirm() {
    setBusy(true);
    setSummary('');
    try {
      await accountApi.updateDepartment(department.id, { archived: archiving });
      onDone(archivedMessage(department.name, archiving));
    } catch (error) {
      if (alive.current) setSummary(error.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel
      headingId="archive-department-heading"
      title={`${archiving ? 'Archive' : 'Restore'} ${department.name}?`}
      onClose={onClose}
    >
      <p className="account-note">
        {archiving ? archiveNote(department) : restoreNote(department)}
      </p>
      <ErrorSummary message={summary} />
      <div className="account-actions">
        <button
          type="button"
          className={archiving ? 'account-danger' : 'account-primary'}
          onClick={confirm}
          disabled={busy}
        >
          {busy ? 'Saving…' : archiving ? 'Archive department' : 'Restore department'}
        </button>
        <button type="button" className="account-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Panel>
  );
}

// Settings > Departments, for signed-in HR.
export default function HrSettings({ headingRef }) {
  // A new page view: start from a fresh list so Employees counts are current.
  useState(() => departmentCache.reset());
  const { departments, error, reload } = useDepartments();
  const [panel, setPanel] = useState(null);
  const [notice, setNotice] = useState('');
  const opener = useRef(null),
    sectionHeading = useRef(null),
    addButton = useRef(null);
  function open(next) {
    opener.current = document.activeElement;
    setNotice('');
    setPanel(next);
  }
  function close() {
    setPanel(null);
    requestAnimationFrame(() => {
      const target = opener.current?.isConnected ? opener.current : sectionHeading.current;
      target?.focus();
    });
  }
  function done(message) {
    setPanel(null);
    setNotice(message);
    departmentCache.invalidate();
    requestAnimationFrame(() => sectionHeading.current?.focus());
  }
  const selected = panel?.id && departments?.find((department) => department.id === panel.id);
  return (
    <>
      <ScreenHeading
        headingRef={headingRef}
        kicker="SETTINGS"
        title="Settings."
        text="Set up how your company is organised."
      />
      <section className="hr-accounts" aria-labelledby="hr-departments-heading">
        <div className="hr-accounts-heading">
          <div>
            <h2 id="hr-departments-heading" tabIndex={-1} ref={sectionHeading}>
              Departments
            </h2>
            <p>Each department sets the prefix of new Employee IDs.</p>
          </div>
          <div className="account-actions">
            <button
              type="button"
              className="account-primary"
              ref={addButton}
              onClick={() => open({ type: 'add' })}
              aria-expanded={panel?.type === 'add'}
            >
              <Icon name="settings" size={17} />
              Add department
            </button>
          </div>
        </div>
        <p role="status" className="account-notice" hidden={!notice}>
          {notice}
        </p>
        {error && (
          <div className="account-error-summary" role="alert">
            <Icon name="info" size={18} />
            <p>{error}</p>
            <button type="button" className="account-link-button" onClick={reload}>
              Try again
            </button>
          </div>
        )}
        {panel?.type === 'add' && departments && (
          <Panel headingId="add-department-heading" title="Add department" onClose={close}>
            <DepartmentForm
              idPrefix="add-department"
              departments={departments}
              submitLabel="Add department"
              onClose={close}
              onSubmit={async (form) => {
                const { department } = await accountApi.createDepartment({
                  name: form.name.trim(),
                  prefix: form.prefix,
                });
                done(addedMessage(department));
              }}
            />
          </Panel>
        )}
        {panel?.type === 'edit' && selected && (
          <Panel
            key={panel.id}
            headingId="edit-department-heading"
            title={`Edit ${selected.name}`}
            onClose={close}
          >
            <DepartmentForm
              idPrefix="edit-department"
              department={selected}
              departments={departments}
              submitLabel="Save department"
              onClose={close}
              onSubmit={async (form) => {
                const result = await accountApi.updateDepartment(
                  selected.id,
                  patchBody(selected, form),
                );
                done(
                  savedMessage(result.department?.name || form.name.trim(), result.updatedProfiles),
                );
              }}
            />
          </Panel>
        )}
        {panel?.type === 'archive' && selected && (
          <ArchivePanel key={panel.id} department={selected} onClose={close} onDone={done} />
        )}
        {!departments && !error && <p role="status">Loading departments…</p>}
        {departments && !departments.length && (
          <p className="account-note">No departments yet. Add the first one.</p>
        )}
        {departments && departments.length > 0 && (
          <div className="account-table-wrap">
            <table className="account-table">
              <caption className="account-visually-hidden">Departments</caption>
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Prefix</th>
                  <th scope="col">Example ID</th>
                  <th scope="col">Employees</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((department) => (
                  <tr key={department.id}>
                    <th scope="row" data-label="Department">
                      {department.name}
                    </th>
                    <td data-label="Prefix">{department.prefix}</td>
                    <td data-label="Example ID">{department.exampleId}</td>
                    <td data-label="Employees">{employeesLabel(department.employees)}</td>
                    <td data-label="Status">
                      <span className={'account-badge' + (department.archived ? ' is-muted' : '')}>
                        {statusLabel(department)}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="account-row-actions">
                        <button
                          type="button"
                          aria-label={'Edit ' + department.name}
                          onClick={() => open({ type: 'edit', id: department.id })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={
                            (department.archived ? 'Restore ' : 'Archive ') + department.name
                          }
                          onClick={() => open({ type: 'archive', id: department.id })}
                        >
                          {department.archived ? 'Restore' : 'Archive'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
