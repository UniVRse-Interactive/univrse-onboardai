import React, { useRef, useState } from 'react';
import Icon from '../portal/Icon';
import OnboardAiBrand from '../brand/OnboardAiBrand';
import './account-access.css';
import './login-page.css';

export function AccessBrand() {
  return <OnboardAiBrand />;
}

function PasswordField({ id, label, confirm = false, onForgot }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="access-field">
      <div className="login-field-label">
        <label htmlFor={id}>{label}</label>
        {onForgot && (
          <button type="button" className="access-forgot" onClick={onForgot}>
            Forgot password?
          </button>
        )}
      </div>
      <div className="access-password">
        <input
          id={id}
          name={confirm ? 'confirmPassword' : 'password'}
          type={visible ? 'text' : 'password'}
          autoComplete={confirm || id.includes('signup') ? 'new-password' : 'current-password'}
          placeholder={confirm ? 'Repeat your password' : 'Enter your password'}
          minLength={id.includes('signup') ? 8 : undefined}
          maxLength={128}
          required
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

function AccountForm({ role, signup, onMode, onGuest }) {
  const [notice, setNotice] = useState('');
  const noticeRef = useRef(null);
  function announce(message) {
    setNotice(message);
    requestAnimationFrame(() => noticeRef.current?.focus());
  }
  function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (signup && fields.get('password') !== fields.get('confirmPassword')) {
      announce('The passwords do not match. Please enter the same password in both fields.');
      return;
    }
    // Interface preview only. Never send, save or log credentials without an auth provider.
    event.currentTarget.reset();
    announce(
      signup
        ? 'Registration is not connected yet. No account was created or details saved. Use guest access for now.'
        : 'Sign-in is not connected yet. No details were sent or saved. Use guest access for now.',
    );
  }
  return (
    <>
      <form
        className={'access-form' + (signup ? ' login-signup-form' : '')}
        onSubmit={submit}
        aria-label={
          signup ? 'Create employee account' : role === 'hr' ? 'HR sign-in' : 'Employee sign-in'
        }
      >
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
          onForgot={
            !signup
              ? () =>
                  announce(
                    'Password reset is not connected yet. Contact HR for help with your company account.',
                  )
              : undefined
          }
        />
        {signup ? (
          <>
            <PasswordField id="access-signup-confirm" label="Confirm password" confirm />
            <p className="access-password-hint">Use at least 8 characters for your password.</p>
          </>
        ) : null}
        <button className="access-submit" type="submit">
          <span>
            {signup
              ? 'Create employee account'
              : 'Sign in as ' + (role === 'hr' ? 'HR' : 'employee')}
          </span>
          <Icon name="arrow" size={21} />
        </button>
      </form>
      {role === 'employee' ? (
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
        <span /> <span>Or explore your workspace</span> <span />
      </div>
      <button
        className="access-guest"
        type="button"
        onClick={() => onGuest(role)}
        aria-label={'Continue as ' + (role === 'hr' ? 'HR' : 'employee') + ' without an account'}
      >
        <Icon name={role === 'hr' ? 'people' : 'user'} size={19} />
        <span>Continue without an account</span>
        <Icon name="arrow" size={18} />
      </button>
      <div
        className={'login-access-status' + (notice ? ' has-notice' : '')}
        role="status"
        tabIndex={-1}
        ref={noticeRef}
      >
        <Icon name="info" size={15} />
        <p>{notice || 'Account sign-in is being set up. You can continue without an account.'}</p>
      </div>
    </>
  );
}

export default function LoginPage({ role = 'employee', signup = false, navigate, onGuest }) {
  const isHr = role === 'hr';
  const loginPath = isHr ? '/login/hr' : '/login/employee';
  const otherPath = isHr ? '/login/employee' : '/login/hr';
  function openPage(event, to) {
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      navigate(to);
    }
  }
  return (
    <main className={'login-page' + (signup ? ' is-signup' : '')}>
      <a className="access-skip" href="#access-form-area">
        Skip to sign-in options
      </a>
      <header className="login-header">
        <a
          href={loginPath}
          onClick={(event) => openPage(event, loginPath)}
          aria-label={'OnboardAi ' + (isHr ? 'HR' : 'employee') + ' sign-in'}
        >
          <AccessBrand />
        </a>
        <div className="login-header-access">
          <span className="login-header-note">{isHr ? 'HR ACCESS' : 'EMPLOYEE ACCESS'}</span>
          <a
            className="login-header-switch"
            href={otherPath}
            onClick={(event) => openPage(event, otherPath)}
          >
            {isHr ? 'Employee sign-in' : 'HR sign-in'}
            <Icon name="arrow" size={15} />
          </a>
        </div>
      </header>
      <div className="login-shell">
        <section className="login-introduction" aria-label="Welcome to OnboardAi">
          <div className="login-intro-copy">
            <span className="access-eyebrow">
              {isHr ? 'PEOPLE FIRST. EVERY STEP OF THE WAY.' : 'PEOPLE FIRST. FROM DAY ONE.'}
            </span>
            <h2>
              {isHr ? 'Help people.' : 'A new chapter.'}
              <br />
              <span>{isHr ? 'Start well.' : 'A clearer start.'}</span>
            </h2>
            <p>
              {isHr ? (
                'Bring your people, company guidance and onboarding support into one clear view.'
              ) : (
                <>
                  Find your next step, ask a question,
                  <br className="login-desktop-break" /> and settle in at your own pace.
                </>
              )}
            </p>
          </div>
          <div className="login-alya-scene">
            <div className="login-avatar-frame">
              <img src="/avatars/alya/poster.png" alt="Alya, your virtual onboarding companion" />
            </div>
            <div className="login-alya-copy">
              <span className="login-alya-name">Meet Alya.</span>
              <p>
                {isHr ? 'Clearer guidance.' : 'Ask a question.'}
                <br />
                {isHr ? 'Practical support.' : 'See the steps.'}
                <br />
                {isHr ? 'A better start.' : 'Go at your pace.'}
              </p>
              <span className="login-alya-formats">
                <Icon name="chat" size={16} />
                <span>
                  Text, voice
                  <br />& visual guidance
                </span>
              </span>
            </div>
          </div>
          <p className="login-intro-footer">Different people. A shared beginning.</p>
        </section>
        <section
          className="login-form-side"
          id="access-form-area"
          aria-label="Account access"
          tabIndex={-1}
        >
          <div className="login-form-container">
            <div className="login-form-heading">
              <span className="login-workspace-label">
                <Icon name={isHr ? 'people' : 'user'} size={17} />
                {isHr ? 'PEOPLE & GUIDANCE' : 'YOUR ONBOARDING'}
              </span>
              <h1>
                {signup && !isHr
                  ? 'Create your account.'
                  : isHr
                    ? 'HR sign-in.'
                    : 'Employee sign-in.'}
              </h1>
              <p>
                {signup && !isHr
                  ? 'Join your company’s employee workspace.'
                  : isHr
                    ? 'Access your people, reports and company guidance.'
                    : 'Your next chapter starts here. Welcome back.'}
              </p>
            </div>
            <AccountForm
              key={role + (signup ? '-signup' : '-login')}
              role={role}
              signup={signup && role === 'employee'}
              onMode={(mode) =>
                navigate(mode === 'signup' ? '/signup/employee' : '/login/employee')
              }
              onGuest={onGuest}
            />
          </div>
        </section>
      </div>
      <footer className="login-footer">
        <span>A clearer start. At your own pace.</span>
        <span>Guest workspace · Activity retained for 24 hours</span>
      </footer>
    </main>
  );
}
