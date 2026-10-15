import React, { useEffect, useRef, useState } from 'react';
import Icon from '../portal/Icon';
import OnboardAiBrand from '../brand/OnboardAiBrand';
import './account-access.css';

export function AccessBrand() {
  return <OnboardAiBrand />;
}

export function PasswordField({
  id,
  label,
  confirm = false,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid = false,
  placeholder,
  minLength,
  maxLength,
  name,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="access-field">
      <label htmlFor={id}>{label}</label>
      <div className="access-password">
        <input
          id={id}
          name={name || (confirm ? 'confirmPassword' : 'password')}
          type={visible ? 'text' : 'password'}
          autoComplete={
            autoComplete || (confirm || id.includes('signup') ? 'new-password' : 'current-password')
          }
          placeholder={
            placeholder || (confirm ? 'Enter your password again' : 'Enter your password')
          }
          minLength={minLength ?? (id.includes('signup') ? 8 : undefined)}
          maxLength={maxLength ?? 128}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required
          value={value}
          onChange={onChange}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={(visible ? 'Hide ' : 'Show ') + label.toLowerCase()}
          aria-pressed={visible}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

function AccountForm({ role, signup, onMode, onGuest, accounts, onSignIn, sessionNotice }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState(accounts ? sessionNotice || '' : '');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const noticeRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (accounts && sessionNotice) requestAnimationFrame(() => noticeRef.current?.focus());
    return () => {
      alive.current = false;
    };
  }, []);
  const heading = signup
    ? 'Make yourself at home.'
    : role === 'hr'
      ? 'Support a better start.'
      : 'Welcome back.';
  function announce(message, error = false) {
    setNotice(message);
    setIsError(error);
    requestAnimationFrame(() => noticeRef.current?.focus());
  }
  async function signIn(event) {
    event.preventDefault();
    if (busy) return;
    const submitted = password;
    // The password never stays in the form after a submit, whatever the result.
    setPassword('');
    setBusy(true);
    setNotice('');
    try {
      await onSignIn(username.trim(), submitted);
    } catch (error) {
      if (alive.current) announce(error.message, true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function submit(event) {
    if (accounts) return signIn(event);
    event.preventDefault();
    if (signup && password !== confirmation) {
      announce('The passwords do not match. Please enter the same password in both fields.');
      return;
    }
    // Interface preview only. Never send, save or log credentials without an auth provider.
    setPassword('');
    setConfirmation('');
    announce(
      signup
        ? 'Account registration is not connected yet. No account was created and your details were not sent or saved. You can continue without an account.'
        : 'Account sign-in is not connected yet. Your details were not sent or saved. You can continue without an account.',
    );
  }
  return (
    <>
      <div className="access-form-heading">
        <span className="access-eyebrow">
          {signup ? 'YOUR FIRST CHAPTER' : role === 'hr' ? 'HR WORKSPACE' : 'EMPLOYEE WORKSPACE'}
        </span>
        <h1>{heading}</h1>
        <p>
          {signup
            ? 'Create your employee account to get started.'
            : role === 'hr'
              ? 'Sign in to your company’s HR workspace.'
              : 'A clearer next step starts here.'}
        </p>
      </div>
      <form className="access-form" onSubmit={submit}>
        {signup && (
          <div className="access-field">
            <label htmlFor="access-name">Your name</label>
            <input
              id="access-name"
              name="name"
              autoComplete="name"
              placeholder="What should we call you?"
              maxLength={80}
              required
            />
          </div>
        )}
        <div className="access-field">
          <label htmlFor="access-id">{role === 'hr' ? 'HR ID' : 'Employee ID'}</label>
          <input
            id="access-id"
            name={role === 'hr' ? 'hrId' : 'employeeId'}
            type="text"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={accounts ? username : undefined}
            onChange={accounts ? (e) => setUsername(e.target.value) : undefined}
            aria-describedby={isError && notice ? 'access-notice' : undefined}
            aria-invalid={isError && notice ? true : undefined}
            placeholder={role === 'hr' ? 'Enter your HR ID' : 'Enter your employee ID'}
            maxLength={64}
            pattern=".*\S.*"
            title={
              role === 'hr'
                ? 'Enter your company-issued HR ID.'
                : 'Enter your company-issued employee ID.'
            }
            required
          />
        </div>
        <PasswordField
          id={signup ? 'access-signup-password' : 'access-password'}
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          describedBy={isError && notice ? 'access-notice' : undefined}
          invalid={isError && !!notice}
          maxLength={accounts ? 200 : 128}
        />
        {signup ? (
          <>
            <p className="access-password-hint">Use at least 8 characters.</p>
            <PasswordField
              id="access-signup-confirm"
              label="Confirm password"
              confirm
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </>
        ) : (
          <button
            className="access-forgot"
            type="button"
            onClick={() =>
              announce(
                accounts
                  ? 'Ask HR to reset your password. HR will give you a temporary password.'
                  : 'Password reset is not connected yet. Contact HR for help with your company account.',
              )
            }
          >
            Forgot password?
          </button>
        )}
        <button className="access-submit" type="submit" disabled={busy}>
          <span>
            {signup
              ? 'Create employee account'
              : busy
                ? 'Signing in…'
                : 'Sign in as ' + (role === 'hr' ? 'HR' : 'employee')}
          </span>
          <Icon name="arrow" size={21} />
        </button>
      </form>
      <div
        className={'access-notice' + (isError ? ' is-error' : '')}
        id="access-notice"
        role={isError ? 'alert' : 'status'}
        tabIndex={-1}
        ref={noticeRef}
        hidden={!notice}
      >
        <Icon name="info" size={18} />
        <p>{notice}</p>
      </div>
      {accounts && role === 'employee' ? (
        <p className="access-hr-note" id="access-ask-hr">
          <strong>Ask HR for your account.</strong> HR creates your Employee ID and a temporary
          password for you.
        </p>
      ) : role === 'employee' ? (
        <p className="access-switch-mode">
          {signup ? 'Already have an account?' : 'New to the team?'}{' '}
          <button onClick={() => onMode(signup ? 'login' : 'signup')}>
            {signup ? 'Sign in' : 'Create an account'}
            <Icon name="arrow" size={14} />
          </button>
        </p>
      ) : (
        <p className="access-hr-note">Use the HR ID provided by your company.</p>
      )}
      <div className="access-guest-divider">
        <span /> <span>Just looking around?</span> <span />
      </div>
      <button className="access-guest" onClick={() => onGuest(role)}>
        <Icon name={role === 'hr' ? 'people' : 'user'} size={19} />
        <span>Continue without an account</span>
        <Icon name="arrow" size={18} />
      </button>
      {!accounts && (
        <p className="access-preview-note">
          <span className="access-preview-dot" /> Interface preview · Accounts are not connected
          yet.
        </p>
      )}
    </>
  );
}

export default function LoginPage({
  signup = false,
  navigate,
  onGuest,
  accounts = false,
  onSignIn,
  sessionNotice = '',
}) {
  const [role, setRole] = useState('employee');
  function changeRole(next) {
    setRole(next);
    if (signup) navigate('/login');
  }
  return (
    <main className={'access-page' + (signup ? ' is-signup' : '')}>
      <a className="access-skip" href="#access-form-area">
        Skip to sign-in options
      </a>
      <section className="access-introduction" aria-label="Welcome to OnboardAi">
        <a
          href="/login"
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              navigate('/login');
            }
          }}
          aria-label="OnboardAi welcome"
        >
          <AccessBrand />
        </a>
        <div className="access-intro-copy">
          <span className="access-eyebrow">A GOOD START LOOKS DIFFERENT FOR EVERYONE</span>
          <h2>
            Your next chapter.
            <br />
            <span>Your way.</span>
          </h2>
          <p>
            Meet Alya. Ask a question, find your next step,
            <br className="access-desktop-break" /> and settle in at your own pace.
          </p>
        </div>
        <div className="access-alya-scene">
          <div className="access-scene-line" aria-hidden="true" />
          <div className="access-avatar-frame">
            <img src="/avatars/alya/poster.png" alt="Alya, your virtual onboarding companion" />
          </div>
          <div className="access-alya-caption">
            <span className="access-presence-dot" />
            <span>
              Alya<small>Your onboarding companion</small>
            </span>
            <Icon name="chat" size={24} />
          </div>
          <div className="access-scene-note">
            <span>01 / ONE STEP AT A TIME</span>
            <p>
              A little clarity.
              <br />A better beginning.
            </p>
          </div>
        </div>
        <div className="access-intro-footer">
          <span>TEXT. VOICE. VISUAL GUIDANCE.</span>
          <span>
            YOUR NEXT CHAPTER
            <Icon name="arrow" size={15} />
          </span>
        </div>
      </section>
      <section className="access-form-side" id="access-form-area" aria-label="Account access">
        <div className="access-top-note">
          <span className="access-presence-dot" /> YOUR ONBOARDING SPACE
        </div>
        <div className="access-form-container">
          <fieldset className="access-role-options">
            <legend>Choose your workspace</legend>
            {['employee', 'hr'].map((value) => (
              <label key={value} className={role === value ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="workspace"
                  value={value}
                  checked={role === value}
                  onChange={() => changeRole(value)}
                />
                <Icon name={value === 'hr' ? 'people' : 'user'} size={18} />
                <span>{value === 'hr' ? 'HR team' : 'Employee'}</span>
              </label>
            ))}
          </fieldset>
          <AccountForm
            key={role + (signup ? '-signup' : '-login')}
            role={role}
            signup={!accounts && signup && role === 'employee'}
            accounts={accounts}
            onSignIn={onSignIn}
            sessionNotice={sessionNotice}
            onMode={(mode) => navigate(mode === 'signup' ? '/signup' : '/login')}
            onGuest={onGuest}
          />
        </div>
        <p className="access-form-footer">A space to ask. A way to move forward.</p>
      </section>
    </main>
  );
}
