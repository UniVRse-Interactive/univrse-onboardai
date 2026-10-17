import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import { accountApi } from './account-api.mjs';
import AutofillControl, { useProfileAutofill } from './AutofillControl';
import { SecretField, TextField, useFocusFirstError } from './account-fields';
import DepartmentField from './DepartmentField';
import { useDepartments } from './use-departments';
import EmployeeCreatedDialog from './EmployeeCreatedDialog';
import { autoIdNote, departmentProblem } from './employee-departments.mjs';
import { canConfirmDelete, deleteErrorMessage } from './delete-confirm.mjs';
import { accountBadges, employeeNames, formatDateTime, formatDay } from './profile-display.mjs';
import {
  employeeErrorTarget,
  clearResolvedErrors,
  fieldErrors,
  formToProfileInput,
  passwordProblem,
  profileGroups,
  profileToForm,
  validateProfileForm,
} from './profile-validation.mjs';
import { journeyApi } from './journey-api.mjs';
import {
  firstDayBody,
  firstDayErrorView,
  firstDayLimits,
  firstDayToForm,
  hrStepAction,
  hrStepError,
  hrStepStatus,
  onboardingCell,
  trackLabel,
  tracks,
  validateFirstDay,
} from './hr-journey.mjs';
import {
  areaBadge,
  areaSummary,
  areasSummary,
  optionalStepLabel,
  thresholdOf,
} from './onboarding-view.mjs';
import './accounts.css';
import './hr-journey.css';

const inputTypes = { date: 'date', email: 'email', phone: 'tel' };

// The four profile groups. `errors` is keyed 'job.fullName' etc.
export function ProfileFields({
  idPrefix,
  form,
  onChange,
  errors,
  marks = {},
  notes = {},
  onEdit,
  requireDepartment = false,
  legacyDepartment = '',
  departments = null,
  departmentError = '',
}) {
  return profileGroups.map((group) => (
    <fieldset className="account-group" key={group.key}>
      <legend>{group.title}</legend>
      <div className="account-group-fields">
        {group.fields.map((field) => {
          const path = `${group.key}.${field.key}`;
          const change = (value) => {
            onEdit?.(path);
            onChange({ ...form, [group.key]: { ...form[group.key], [field.key]: value } });
          };
          if (field.kind === 'track')
            return (
              <div className="access-field account-field" key={path}>
                <label htmlFor={`${idPrefix}-${group.key}-${field.key}`}>{field.label}</label>
                <select
                  id={`${idPrefix}-${group.key}-${field.key}`}
                  value={form[group.key][field.key]}
                  aria-invalid={errors[path] ? true : undefined}
                  aria-describedby={`${idPrefix}-track-hint`}
                  onChange={(event) => change(event.target.value)}
                >
                  {tracks.map((track) => (
                    <option key={track.value} value={track.value}>
                      {track.label}
                    </option>
                  ))}
                </select>
                <p className="account-field-hint" id={`${idPrefix}-track-hint`}>
                  Sets which onboarding steps and quick questions this person gets.
                </p>
                {errors[path] && <p className="account-field-error">{errors[path]}</p>}
              </div>
            );
          if (field.kind === 'department')
            return (
              <DepartmentField
                key={path}
                id={`${idPrefix}-${group.key}-${field.key}`}
                label={field.label}
                required={requireDepartment}
                legacy={legacyDepartment}
                departments={departments}
                loadError={departmentError}
                showIdHint={requireDepartment}
                value={form[group.key][field.key]}
                onChange={change}
                error={errors[path]}
                fromDocument={!!marks[path]}
                note={notes[path]}
              />
            );
          return (
            <TextField
              key={path}
              id={`${idPrefix}-${group.key}-${field.key}`}
              label={field.label}
              required={field.required}
              type={inputTypes[field.kind] || 'text'}
              inputMode={field.kind === 'phone' ? 'tel' : undefined}
              maxLength={field.kind === 'date' ? undefined : field.max}
              value={form[group.key][field.key]}
              onChange={change}
              error={errors[path]}
              fromDocument={!!marks[path]}
              note={notes[path]}
            />
          );
        })}
      </div>
    </fieldset>
  ));
}

export function Panel({ headingId, title, onClose, children }) {
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <section
      className="account-panel"
      role="group"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="account-panel-heading">
        <h3 id={headingId} tabIndex={-1} ref={headingRef}>
          {title}
        </h3>
        <button type="button" className="account-link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
      {children}
    </section>
  );
}

export function ErrorSummary({ message, summaryRef }) {
  return (
    <div
      className="account-error-summary"
      role="alert"
      tabIndex={-1}
      ref={summaryRef}
      hidden={!message}
    >
      <Icon name="info" size={18} />
      <p>{message}</p>
    </div>
  );
}

// Applies a server error to the form: PROFILE_INVALID fields, an ID/password
// problem, or a general message.
function applyServerError(error, setErrors, setSummary) {
  if (error.code === 'PROFILE_INVALID') {
    const { errors, general } = fieldErrors(error.fields);
    setErrors(errors);
    setSummary(
      Object.keys(errors).length && !general.length ? '' : general.join(' ') || error.message,
    );
    return;
  }
  const target = employeeErrorTarget(error.code);
  if (target) {
    setErrors({ [target]: error.message });
    setSummary('');
    return;
  }
  setErrors({});
  setSummary(error.message);
}

function AddEmployeePanel({ onClose, onCreated, autofillEnabled }) {
  const { departments, error: departmentError } = useDepartments();
  const [profile, setProfile] = useState(() => profileToForm(null));
  const autofill = useProfileAutofill(profile, setProfile);
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  // A shown error clears once its field gets a valid value (typed or autofilled).
  const previousForm = useRef(profile);
  useEffect(() => {
    const before = previousForm.current;
    previousForm.current = profile;
    if (before) setErrors((current) => clearResolvedErrors(current, before, profile));
  }, [profile]);
  const formRef = useRef(null),
    summaryRef = useRef(null),
    alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useFocusFirstError(formRef, errors, summaryRef, summary);
  async function submit(event) {
    event.preventDefault();
    if (busy || autofill.reading) return;
    const found = fieldErrors(validateProfileForm(profile)).errors;
    const departmentMessage = departmentProblem(profile, departments);
    if (departmentMessage) found['job.department'] = departmentMessage;
    setSummary('');
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const input = formToProfileInput(profile);
      const { employee, temporaryPassword } = await accountApi.createEmployee(input);
      onCreated({
        username: employee.account.username,
        temporaryPassword,
        fullName: input.job.fullName,
        department: input.job.department,
      });
    } catch (error) {
      if (alive.current) applyServerError(error, setErrors, setSummary);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel headingId="add-employee-heading" title="Add employee account" onClose={onClose}>
      <form className="account-form" onSubmit={submit} ref={formRef} noValidate>
        <p className="account-note">{autoIdNote}</p>
        <AutofillControl idPrefix="add" enabled={autofillEnabled} autofill={autofill} />
        <ProfileFields
          idPrefix="add"
          form={profile}
          onChange={setProfile}
          errors={errors}
          marks={autofill.marks}
          notes={autofill.notes}
          onEdit={autofill.edited}
          requireDepartment
          departments={departments}
          departmentError={departmentError}
        />
        <ErrorSummary message={summary} summaryRef={summaryRef} />
        <div className="account-actions">
          <button className="account-primary" type="submit" disabled={busy || !!autofill.reading}>
            {busy ? 'Creating…' : 'Create employee account'}
          </button>
          <button type="button" className="account-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}

function EditProfilePanel({ employee, onClose, onDone, autofillEnabled }) {
  const { departments, error: departmentError } = useDepartments();
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const [legacyDepartment, setLegacyDepartment] = useState('');
  const autofill = useProfileAutofill(form, setForm);
  // A shown error clears once its field gets a valid value (typed or autofilled).
  const previousForm = useRef(form);
  useEffect(() => {
    const before = previousForm.current;
    previousForm.current = form;
    if (before) setErrors((current) => clearResolvedErrors(current, before, form));
  }, [form]);
  const formRef = useRef(null),
    summaryRef = useRef(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    accountApi
      .employee(employee.account.id)
      .then((data) => {
        if (!alive.current) return;
        setForm(profileToForm(data.employee.profile));
        setUpdatedAt(data.employee.profile?.updatedAt || '');
        setLegacyDepartment(String(data.employee.profile?.job?.department ?? ''));
      })
      .catch((error) => alive.current && setLoadError(error.message));
    return () => {
      alive.current = false;
    };
  }, [employee.account.id]);
  useFocusFirstError(formRef, errors, summaryRef, summary);
  async function submit(event) {
    event.preventDefault();
    if (busy || autofill.reading) return;
    const found = fieldErrors(validateProfileForm(form)).errors;
    setSummary('');
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await accountApi.saveProfile(employee.account.id, formToProfileInput(form));
      onDone(`Saved the profile for ${employee.account.username}.`);
    } catch (error) {
      if (alive.current) applyServerError(error, setErrors, setSummary);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel
      headingId="edit-profile-heading"
      title={`Edit profile for ${employee.account.username}`}
      onClose={onClose}
    >
      {loadError ? (
        <p role="alert" className="account-error-summary">
          {loadError}
        </p>
      ) : !form ? (
        <p role="status">Loading profile…</p>
      ) : (
        <form className="account-form" onSubmit={submit} ref={formRef} noValidate>
          {updatedAt && <p className="account-note">Last updated {formatDateTime(updatedAt)}.</p>}
          <AutofillControl idPrefix="edit" enabled={autofillEnabled} autofill={autofill} />
          <ProfileFields
            idPrefix="edit"
            form={form}
            onChange={setForm}
            errors={errors}
            marks={autofill.marks}
            notes={autofill.notes}
            onEdit={autofill.edited}
            legacyDepartment={legacyDepartment}
            departments={departments}
            departmentError={departmentError}
          />
          <ErrorSummary message={summary} summaryRef={summaryRef} />
          <div className="account-actions">
            <button className="account-primary" type="submit" disabled={busy || !!autofill.reading}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            <button type="button" className="account-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function ResetPasswordPanel({ employee, onClose, onDone }) {
  const username = employee.account.username;
  const [values, setValues] = useState({ temporaryPassword: '', confirmation: '' });
  const [errors, setErrors] = useState({});
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
  useFocusFirstError(formRef, errors, summaryRef, summary);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const submitted = { ...values };
    setSummary('');
    const problem = passwordProblem(submitted.temporaryPassword, username);
    if (problem || submitted.temporaryPassword !== submitted.confirmation) {
      setErrors(
        problem ? { temporaryPassword: problem } : { confirmation: 'The passwords do not match.' },
      );
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await accountApi.resetPassword(employee.account.id, submitted.temporaryPassword);
      onDone(
        `Reset the password for ${username}. They must choose a new password at next sign-in.`,
      );
    } catch (error) {
      if (!alive.current) return;
      if (error.code === 'PASSWORD_REJECTED') setErrors({ temporaryPassword: error.message });
      else {
        setErrors({});
        setSummary(error.message);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel
      headingId="reset-password-heading"
      title={`Reset password for ${username}`}
      onClose={onClose}
    >
      <form className="account-form" onSubmit={submit} ref={formRef} noValidate>
        <p className="account-note">
          Enter a new temporary password. This signs {username} out everywhere and clears any lock.
          They must choose their own password at next sign-in.
        </p>
        <div className="account-group-fields">
          <SecretField
            id="reset-temporary-password"
            label="New temporary password"
            autoComplete="new-password"
            value={values.temporaryPassword}
            onChange={(value) =>
              setValues((previous) => ({ ...previous, temporaryPassword: value }))
            }
            error={errors.temporaryPassword}
          />
          <SecretField
            id="reset-temporary-confirm"
            label="Confirm new temporary password"
            confirm
            autoComplete="new-password"
            value={values.confirmation}
            onChange={(value) => setValues((previous) => ({ ...previous, confirmation: value }))}
            error={errors.confirmation}
          />
        </div>
        <ErrorSummary message={summary} summaryRef={summaryRef} />
        <div className="account-actions">
          <button className="account-primary" type="submit" disabled={busy}>
            {busy ? 'Resetting…' : 'Reset password'}
          </button>
          <button type="button" className="account-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}

function StatusPanel({ employee, next, onClose, onDone }) {
  const username = employee.account.username;
  const disabling = next === 'disabled';
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
      await accountApi.setStatus(employee.account.id, next);
      onDone(`${disabling ? 'Disabled' : 'Enabled'} ${username}.`);
    } catch (error) {
      if (alive.current) setSummary(error.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel
      headingId="status-heading"
      title={`${disabling ? 'Disable' : 'Enable'} ${username}?`}
      onClose={onClose}
    >
      <p className="account-note">
        {disabling
          ? `${username} will be signed out everywhere and will not be able to sign in until you enable the account again. Their profile and saved conversations are kept.`
          : `${username} will be able to sign in again with their current password.`}
      </p>
      {summary && (
        <div className="account-error-summary" role="alert">
          <Icon name="info" size={18} />
          <p>{summary}</p>
        </div>
      )}
      <div className="account-actions">
        <button
          type="button"
          className={disabling ? 'account-danger' : 'account-primary'}
          onClick={confirm}
          disabled={busy}
        >
          {busy ? 'Saving…' : disabling ? 'Disable account' : 'Enable account'}
        </button>
        <button type="button" className="account-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Panel>
  );
}

function DeletePanel({ employee, onClose, onDone, onMissing }) {
  const username = employee.account.username;
  const [typed, setTyped] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  async function confirm(event) {
    event.preventDefault();
    if (busy || !canConfirmDelete(typed, username)) return;
    setBusy(true);
    setSummary('');
    try {
      await accountApi.deleteEmployee(employee.account.id);
      onDone(`Deleted ${username}. The account, profile, chats and support summary were removed.`);
    } catch (error) {
      if (error?.code === 'EMPLOYEE_NOT_FOUND' || error?.status === 404) onMissing(username);
      else if (alive.current) setSummary(deleteErrorMessage(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel headingId="delete-heading" title={`Delete ${username}?`} onClose={onClose}>
      <form className="account-form account-delete-confirm" onSubmit={confirm} noValidate>
        <p className="account-note">
          This permanently removes {username}: their account, profile, saved chats and support
          summary. It cannot be undone.
        </p>
        <div className="access-field account-field">
          <label htmlFor="delete-confirm-id">Type {username} to confirm</label>
          <input
            id="delete-confirm-id"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        {summary && (
          <div className="account-error-summary" role="alert">
            <Icon name="info" size={18} />
            <p>{summary}</p>
          </div>
        )}
        <div className="account-actions">
          <button
            type="submit"
            className="account-danger"
            disabled={busy || !canConfirmDelete(typed, username)}
          >
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
          <button type="button" className="account-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}

const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');

// What the employee's saved activities show, read-only. Working preferences are
// private to the employee and never reach this view.
function VerificationRecords({ records }) {
  const rows = [];
  for (const [id, record] of Object.entries(records.policies || {})) {
    rows.push([
      id,
      [
        record.acknowledgedAt ? `acknowledged ${day(record.acknowledgedAt)}` : 'not acknowledged',
        record.quiz
          ? `quiz ${record.quiz.passed ? 'passed' : 'not passed'} · best ${record.quiz.score}% of ${record.quiz.passingScore}% needed · ${record.quiz.attempts} attempt${record.quiz.attempts === 1 ? '' : 's'}`
          : 'no quiz taken',
      ].join(' · '),
    ]);
  }
  for (const [id, record] of Object.entries(records.alignment || {}))
    rows.push([
      'alignment.' + id,
      `${record.passed ? 'passed ' + day(record.passedAt || record.completedAt) : 'not passed'} · ${record.attempts} attempt${record.attempts === 1 ? '' : 's'}${record.score != null ? ' · ' + record.score + '%' : ''}`,
    ]);
  const roleTools = records.roleTools || {};
  if (roleTools.responsibilities)
    rows.push(['Role checklist', `acknowledged ${day(roleTools.responsibilities.acknowledgedAt)}`]);
  for (const [id, tool] of Object.entries(roleTools.tools || {}))
    rows.push([
      id,
      tool.status === 'confirmed'
        ? `access confirmed ${day(tool.confirmedAt)}`
        : `awaiting your confirmation · reported account ${tool.workEmail}`,
    ]);
  const team = records.teamSupport || {};
  if (team.routing)
    rows.push([
      'Support routing',
      `${team.routing.passed ? 'passed' : 'not passed'} · ${team.routing.attempts} attempt${team.routing.attempts === 1 ? '' : 's'}`,
    ]);
  if (team.confirmedHelpAt)
    rows.push(['Knows where to find help', `confirmed ${day(team.confirmedHelpAt)}`]);
  return (
    <details className="hrj-records">
      <summary>Verification records ({rows.length})</summary>
      {rows.length ? (
        <ul>
          {rows.map(([name, detail]) => (
            <li key={name}>
              <strong>{name}</strong> — {detail}
            </li>
          ))}
        </ul>
      ) : (
        <p>No verification activity saved yet.</p>
      )}
      <p className="account-note">
        Self-confirmed setup tasks and the AI self-assessment appear in the steps below.
      </p>
    </details>
  );
}

// Per-employee onboarding progress, with Verify / Unverify for steps HR confirms.
function OnboardingPanel({ employee, onClose, onChanged }) {
  const username = employee.account.username;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [records, setRecords] = useState({});
  const tools = records.roleTools?.tools || {};
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    journeyApi
      .employeeOnboarding(employee.account.id)
      .then((value) => alive.current && setData(value))
      .catch((err) => alive.current && setError(err.message));
    journeyApi
      .employeeVerifications(employee.account.id)
      .then((value) => alive.current && setRecords(value.verifications || {}))
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [employee.account.id]);
  async function change(step, status) {
    setBusy(step.id);
    setError('');
    setNotice('');
    try {
      const next = await journeyApi.setEmployeeStep(employee.account.id, step.id, status);
      if (!alive.current) return;
      setData(next);
      setNotice(status === 'done' ? `Verified “${step.title}”.` : `Moved “${step.title}” back.`);
      onChanged();
    } catch (err) {
      if (alive.current) setError(hrStepError(err));
    } finally {
      if (alive.current) setBusy('');
    }
  }
  // Tool access is completed only by this confirmation, not by the employee.
  async function confirmAccess(step) {
    setBusy(step.id);
    setError('');
    setNotice('');
    try {
      const result = await journeyApi.confirmToolAccess(employee.account.id, step.id);
      if (!alive.current) return;
      setData(result.onboarding);
      setRecords({
        ...records,
        roleTools: {
          ...records.roleTools,
          tools: { ...tools, [step.id]: { ...tools[step.id], status: 'confirmed' } },
        },
      });
      setNotice(`Confirmed access for “${step.title}”.`);
      onChanged();
    } catch (err) {
      if (alive.current) setError(hrStepError(err));
    } finally {
      if (alive.current) setBusy('');
    }
  }
  return (
    <Panel headingId="onboarding-heading" title={`Onboarding for ${username}`} onClose={onClose}>
      {error && (
        <p className="account-error-summary" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading onboarding…</p>}
      {data && (
        <>
          <p className="account-note">
            {trackLabel(data.track)} track · {data.percent}% done · {areasSummary(data)}
            {data.complete ? ' · Onboarding complete' : ''}
            {data.waitingOnHr ? ` · ${data.waitingOnHr} waiting for you to verify` : ''}
          </p>
          <p role="status" className="account-notice" hidden={!notice}>
            {notice}
          </p>
          <VerificationRecords records={records} />
          <div className="hrj-areas">
            {data.areas.map((area) => (
              <section className="hrj-area" key={area.id} aria-labelledby={'hrj-' + area.id}>
                <h4 id={'hrj-' + area.id}>
                  <span aria-hidden="true">{area.icon}</span> {area.title}{' '}
                  <span>
                    {area.percent}% · {areaSummary(area)}
                  </span>
                  {areaBadge(area, data) && (
                    <span className="account-badge hrj-complete">{areaBadge(area, data)}</span>
                  )}
                </h4>
                <span
                  className="hrj-bar"
                  role="progressbar"
                  aria-label={`${area.title} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={area.percent}
                >
                  <span style={{ width: area.percent + '%' }} />
                  <i
                    style={{ left: thresholdOf(data) + '%' }}
                    title={thresholdOf(data) + '% marker'}
                  />
                </span>
                <ul className="hrj-steps">
                  {area.steps.map((step) => {
                    const action = hrStepAction(step);
                    return (
                      <li key={step.id} className={'hrj-step ' + step.status}>
                        <div>
                          <strong>{step.title}</strong>
                          <small>
                            {hrStepStatus(step)}
                            {optionalStepLabel(step) ? ' · Optional' : ''}
                          </small>
                        </div>
                        {tools[step.id]?.status === 'awaiting_confirmation' &&
                          step.status !== 'done' && (
                            <button
                              type="button"
                              disabled={busy === step.id}
                              aria-label={`Confirm access: ${step.title}`}
                              title={`Employee reported ${tools[step.id].workEmail}. Confirm only after checking access.`}
                              onClick={() => confirmAccess(step)}
                            >
                              Confirm access
                            </button>
                          )}
                        {action && (
                          <button
                            type="button"
                            disabled={busy === step.id}
                            aria-label={`${action.label}: ${step.title}`}
                            onClick={() =>
                              change(step, action.action === 'verify' ? 'done' : 'todo')
                            }
                          >
                            {action.label}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

// Per-employee first-day details (what the employee's "Your first day" card shows).
function FirstDayPanel({ employee, onClose, onDone }) {
  const username = employee.account.username;
  const [form, setForm] = useState(null);
  const [startDate, setStartDate] = useState(null);
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null),
    summaryRef = useRef(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    journeyApi
      .employeeFirstDay(employee.account.id)
      .then((data) => {
        if (!alive.current) return;
        setForm(firstDayToForm(data.firstDay));
        setStartDate(data.startDate);
      })
      .catch((err) => alive.current && setSummary(err.message));
    return () => {
      alive.current = false;
    };
  }, [employee.account.id]);
  useFocusFirstError(formRef, errors, summaryRef, summary);
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (busy || !form) return;
    const found = validateFirstDay(form);
    setSummary('');
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await journeyApi.saveFirstDay(employee.account.id, firstDayBody(form));
      onDone(`Saved first-day details for ${username}.`);
    } catch (error) {
      if (!alive.current) return;
      const view = firstDayErrorView(error);
      setErrors(view.errors);
      setSummary(view.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Panel
      headingId="first-day-heading"
      title={`First-day details for ${username}`}
      onClose={onClose}
    >
      {!form ? (
        summary ? (
          <p className="account-error-summary" role="alert">
            {summary}
          </p>
        ) : (
          <p role="status">Loading first-day details…</p>
        )
      ) : (
        <form className="account-form" onSubmit={submit} ref={formRef} noValidate>
          <p className="account-note">
            {startDate
              ? `Start date: ${formatDay(startDate)}. `
              : 'No start date in the profile yet. '}
            The employee sees this on their dashboard and when they ask Alya where to go.
          </p>
          <div className="account-group-fields">
            <TextField
              id="first-day-location"
              label="Where to go"
              required
              maxLength={firstDayLimits.location}
              value={form.location}
              onChange={set('location')}
              error={errors.location}
            />
            <TextField
              id="first-day-time"
              label="Arrival time"
              required
              type="time"
              value={form.arrivalTime}
              onChange={set('arrivalTime')}
              error={errors.arrivalTime}
              hint="24-hour time, for example 09:00."
            />
            <TextField
              id="first-day-host"
              label="Host name"
              required
              maxLength={firstDayLimits.hostName}
              value={form.hostName}
              onChange={set('hostName')}
              error={errors.hostName}
            />
            <TextField
              id="first-day-contact"
              label="Host contact"
              maxLength={firstDayLimits.hostContact}
              value={form.hostContact}
              onChange={set('hostContact')}
              error={errors.hostContact}
              hint="Phone or email. Optional."
            />
            <TextField
              id="first-day-notes"
              label="Notes"
              maxLength={firstDayLimits.notes}
              value={form.notes}
              onChange={set('notes')}
              error={errors.notes}
              hint="Anything else to know, such as what to bring. Optional."
            />
          </div>
          <ErrorSummary message={summary} summaryRef={summaryRef} />
          <div className="account-actions">
            <button className="account-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save first-day details'}
            </button>
            <button type="button" className="account-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

export default function HrEmployees() {
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(null);
  const [created, setCreated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const opener = useRef(null),
    headingRef = useRef(null),
    addButton = useRef(null),
    sequence = useRef(0);
  const load = useCallback(async () => {
    const token = ++sequence.current;
    setLoading(true);
    try {
      const data = await accountApi.listEmployees();
      if (token !== sequence.current) return;
      setEmployees(data.employees);
      setError('');
    } catch (err) {
      if (token === sequence.current) setError(err.message);
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    accountApi
      .config({ report: false })
      .then((config) => setAutofillEnabled(config?.profileAutofill === true))
      .catch(() => {});
    load();
    // Employees change their own password and sign in elsewhere; refresh when
    // HR returns to this page.
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      sequence.current++;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load]);
  function open(next) {
    opener.current = document.activeElement;
    setNotice('');
    setPanel(next);
  }
  function close() {
    setPanel(null);
    requestAnimationFrame(() => {
      const target = opener.current?.isConnected ? opener.current : headingRef.current;
      target?.focus();
    });
  }
  function done(message) {
    setPanel(null);
    setNotice(message);
    load();
    requestAnimationFrame(() => headingRef.current?.focus());
  }
  function onCreated(result) {
    setPanel(null);
    setCreated(result);
    setNotice(
      `Created employee account ${result.username}. They must choose a new password at first sign-in.`,
    );
    load();
  }
  // The password is dropped with the dialog: nothing else keeps it.
  function closeCreated() {
    setCreated(null);
    requestAnimationFrame(() => addButton.current?.focus());
  }
  function missing(username) {
    done(`${username} no longer exists. The list has been refreshed.`);
  }
  const selected = panel?.id && employees?.find((e) => e.account.id === panel.id);
  return (
    <section className="hr-accounts" id="employee-accounts" aria-labelledby="hr-accounts-heading">
      <div className="hr-accounts-heading">
        <div>
          <span className="access-eyebrow">02 / ACCOUNTS</span>
          <h2 id="hr-accounts-heading" tabIndex={-1} ref={headingRef}>
            Employee accounts
          </h2>
          <p>
            Create employee accounts, reset passwords, edit profiles and turn accounts on or off.
          </p>
        </div>
        <div className="account-actions">
          <button type="button" className="account-secondary" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh accounts'}
          </button>
          <button
            type="button"
            className="account-primary"
            ref={addButton}
            onClick={() => open({ type: 'add' })}
          >
            <Icon name="user" size={17} />
            Add employee account
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
          <button type="button" className="account-link-button" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {panel?.type === 'add' && (
        <AddEmployeePanel onClose={close} onCreated={onCreated} autofillEnabled={autofillEnabled} />
      )}
      {created && <EmployeeCreatedDialog created={created} onClose={closeCreated} />}
      {panel?.type === 'edit' && selected && (
        <EditProfilePanel
          key={panel.id}
          employee={selected}
          onClose={close}
          onDone={done}
          autofillEnabled={autofillEnabled}
        />
      )}
      {panel?.type === 'onboarding' && selected && (
        <OnboardingPanel key={panel.id} employee={selected} onClose={close} onChanged={load} />
      )}
      {panel?.type === 'firstday' && selected && (
        <FirstDayPanel key={panel.id} employee={selected} onClose={close} onDone={done} />
      )}
      {panel?.type === 'reset' && selected && (
        <ResetPasswordPanel key={panel.id} employee={selected} onClose={close} onDone={done} />
      )}
      {panel?.type === 'status' && selected && (
        <StatusPanel
          key={panel.id + panel.next}
          employee={selected}
          next={panel.next}
          onClose={close}
          onDone={done}
        />
      )}
      {panel?.type === 'delete' && selected && (
        <DeletePanel
          key={panel.id}
          employee={selected}
          onClose={close}
          onDone={done}
          onMissing={missing}
        />
      )}
      {!employees && !error && <p role="status">Loading employee accounts…</p>}
      {employees && !employees.length && (
        <p className="account-note">No employee accounts yet. Add the first one.</p>
      )}
      {employees && employees.length > 0 && (
        <div className="account-table-wrap">
          <table className="account-table">
            <caption className="account-visually-hidden">Employee accounts</caption>
            <thead>
              <tr>
                <th scope="col">Employee ID</th>
                <th scope="col">Name</th>
                <th scope="col">Job title</th>
                <th scope="col">Department</th>
                <th scope="col">Track</th>
                <th scope="col">Onboarding</th>
                <th scope="col">Start date</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const { account, profile } = employee;
                const names = employeeNames(profile);
                const disabled = account.status === 'disabled';
                return (
                  <tr key={account.id}>
                    <th scope="row" data-label="Employee ID">
                      {account.username}
                    </th>
                    <td data-label="Name">
                      {names.fullName || <span className="account-empty">No profile</span>}
                      {names.preferredName && <small>Preferred: {names.preferredName}</small>}
                    </td>
                    <td data-label="Job title">{profile?.jobTitle || '—'}</td>
                    <td data-label="Department">{profile?.department || '—'}</td>
                    <td data-label="Track">{trackLabel(employee.track)}</td>
                    <td data-label="Onboarding">
                      <span
                        className="hr-table-percent"
                        aria-label={onboardingCell(employee).label}
                      >
                        {onboardingCell(employee).percent}
                        {onboardingCell(employee).complete && (
                          <span className="account-badge hrj-complete">Complete</span>
                        )}
                        {onboardingCell(employee).waiting > 0 && (
                          <small>{onboardingCell(employee).waiting} waiting for HR</small>
                        )}
                      </span>
                    </td>
                    <td data-label="Start date">{formatDay(profile?.startDate) || '—'}</td>
                    <td data-label="Status">
                      <ul className="account-badges" aria-label={'Status of ' + account.username}>
                        {accountBadges(account).map((badge) => (
                          <li
                            key={badge}
                            className={
                              'account-badge' +
                              (badge === 'Disabled' || badge === 'Locked' ? ' is-warning' : '')
                            }
                          >
                            {badge}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td data-label="Last sign-in">
                      {formatDateTime(account.lastSignInAt) || 'Never'}
                    </td>
                    <td data-label="Actions">
                      <div className="account-row-actions">
                        <button
                          type="button"
                          aria-label={'Edit profile for ' + account.username}
                          onClick={() => open({ type: 'edit', id: account.id })}
                        >
                          Edit profile
                        </button>
                        <button
                          type="button"
                          aria-label={'Onboarding for ' + account.username}
                          onClick={() => open({ type: 'onboarding', id: account.id })}
                        >
                          Onboarding
                        </button>
                        <button
                          type="button"
                          aria-label={'First-day details for ' + account.username}
                          onClick={() => open({ type: 'firstday', id: account.id })}
                        >
                          First day
                        </button>
                        <button
                          type="button"
                          aria-label={'Reset password for ' + account.username}
                          onClick={() => open({ type: 'reset', id: account.id })}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          aria-label={(disabled ? 'Enable ' : 'Disable ') + account.username}
                          onClick={() =>
                            open({
                              type: 'status',
                              id: account.id,
                              next: disabled ? 'active' : 'disabled',
                            })
                          }
                        >
                          {disabled ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          type="button"
                          aria-label={'Delete ' + account.username}
                          onClick={() => open({ type: 'delete', id: account.id })}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
