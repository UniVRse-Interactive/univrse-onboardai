import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import OnboardAiBrand from '../brand/OnboardAiBrand';
import DecorativeWebsiteIllustration from './DecorativeWebsiteIllustration';
import { navigation, stages, stageIntros, tasks, supportTeams } from './website-content';
import LoginPage from '../access/LoginPage';
import HrWorkspace from '../access/HrWorkspace';
import GuestEmployeeEntry from '../access/GuestEmployeeEntry';
import ChangePasswordPage from '../access/ChangePasswordPage';
import MyProfilePage from '../access/MyProfilePage';
import useAccountSession from '../access/use-account-session';
import { landingPath, routeDecision } from '../access/account-routing.mjs';
import './website.css';

const AlyaChatPage = React.lazy(() => import('../avatar/AlyaChatPage'));

const storageKey = 'univrse-onboardai-portal-v1';
const emptyState = {
  profile: { name: '', pathway: 'Employee', startDate: '' },
  completed: [],
  notes: [],
};
function readState() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (!value || typeof value !== 'object') return emptyState;
    return {
      profile: {
        name: typeof value.profile?.name === 'string' ? value.profile.name.slice(0, 40) : '',
        pathway: ['Employee', 'Intern', 'Contractor'].includes(value.profile?.pathway)
          ? value.profile.pathway
          : 'Employee',
        startDate:
          typeof value.profile?.startDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(value.profile.startDate)
            ? value.profile.startDate
            : '',
      },
      completed: Array.isArray(value.completed)
        ? [...new Set(value.completed)].filter((id) => tasks.some((task) => task.id === id))
        : [],
      notes: Array.isArray(value.notes)
        ? value.notes
            .filter(
              (note) =>
                typeof note?.id === 'string' &&
                typeof note?.text === 'string' &&
                supportTeams.some((team) => team.id === note.team),
            )
            .slice(0, 10)
        : [],
    };
  } catch {
    return emptyState;
  }
}
function Link({ to, navigate, children, ...props }) {
  return (
    <a
      href={to}
      {...props}
      onClick={(event) => {
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
      }}
    >
      {children}
    </a>
  );
}
function Brand() {
  return <OnboardAiBrand />;
}
function Label({ children }) {
  return <span className="uv-eyebrow">{children}</span>;
}
function TileIcon({ icon, color = 'pink', size = 22 }) {
  return (
    <span className={'uv-tile-icon ' + color}>
      <Icon name={icon} size={size} />
    </span>
  );
}
function PageHeading({ number, eyebrow, title, description, children }) {
  return (
    <header className="uv-page-heading">
      <div>
        <Label>
          <span className="uv-page-number">{number}</span>
          {eyebrow}
        </Label>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </header>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      className={'uv-dialog ' + (wide ? 'wide' : '')}
      ref={ref}
      aria-labelledby="uv-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="uv-dialog-heading">
        <h2 id="uv-dialog-title">{title}</h2>
        <button className="uv-icon-button" aria-label="Close dialog" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function TaskRow({ task, done, onOpen, number }) {
  return (
    <button className={'uv-task-row ' + (done ? 'done' : '')} onClick={() => onOpen(task)}>
      <span className="uv-task-number">
        {done ? (
          <Icon name="check" size={19} />
        ) : (
          String(number || tasks.indexOf(task) + 1).padStart(2, '0')
        )}
      </span>
      <span className="uv-task-copy">
        <strong>{task.title}</strong>
        <small>
          {task.owner} <span>·</span> {task.time}
        </small>
      </span>
      <span className="uv-task-end">
        {done ? <span className="uv-done-label">Done</span> : <Icon name="arrow" size={20} />}
      </span>
    </button>
  );
}
function ProgressRing({ count }) {
  const percent = Math.round((count / tasks.length) * 100);
  return (
    <div
      className="uv-progress-ring"
      role="progressbar"
      aria-label="Onboarding tasks marked done"
      aria-valuemin={0}
      aria-valuemax={tasks.length}
      aria-valuenow={count}
    >
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="80" cy="80" r="66" />
        <circle
          className="uv-ring-fill"
          cx="80"
          cy="80"
          r="66"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
        />
      </svg>
      <div>
        <strong>
          {percent}
          <span>%</span>
        </strong>
        <small>YOUR PROGRESS</small>
      </div>
    </div>
  );
}

function Dashboard({ state, navigate, onTask, onProfile, chatPath }) {
  const pending = tasks.filter((task) => !state.completed.includes(task.id)),
    next = pending[0];
  return (
    <>
      <div className="uv-dashboard-meta">
        <span>
          <span className="uv-live-dot" /> YOUR NEXT CHAPTER
        </span>
        <span>
          UNI / MY <i />{' '}
          {new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Kuala_Lumpur',
          })
            .format(new Date())
            .toUpperCase()}
        </span>
      </div>
      <section className="uv-welcome-hero">
        <div className="uv-hero-copy">
          <Label>WELCOME TO YOUR WORKSPACE</Label>
          <h1>
            {state.profile.name ? (
              <>
                Hey, {state.profile.name}.<br />
                Your next <em>move.</em>
              </>
            ) : (
              <>
                New universe.
                <br />
                Your next <em>move.</em>
              </>
            )}
          </h1>
          <p>
            Find your people. Get your bearings.
            <br />
            Build something that matters.
          </p>
          <div className="uv-hero-actions">
            <button
              className="uv-button primary"
              onClick={() => (next ? onTask(next) : navigate('/onboarding'))}
            >
              {state.completed.length ? 'Continue your journey' : 'Let’s get you started'}
              <Icon name="arrow" size={19} />
            </button>
            <button className="uv-round-link" aria-label="Edit my profile" onClick={onProfile}>
              <Icon name="user" size={21} />
            </button>
          </div>
          <span className="uv-hero-footnote">A CLEARER START. AT YOUR OWN PACE.</span>
        </div>
        <DecorativeWebsiteIllustration />
      </section>
      <section className="uv-progress-strip">
        <div>
          <span className="uv-mini-label">YOUR JOURNEY</span>
          <strong>
            {String(state.completed.length).padStart(2, '0')}
            <span> / {tasks.length} steps</span>
          </strong>
        </div>
        <div
          className="uv-strip-track"
          role="progressbar"
          aria-label="Checklist progress"
          aria-valuemin={0}
          aria-valuemax={tasks.length}
          aria-valuenow={state.completed.length}
        >
          {tasks.map((task) => (
            <span key={task.id} className={state.completed.includes(task.id) ? 'complete' : ''} />
          ))}
        </div>
        <Link to="/onboarding" navigate={navigate}>
          View your roadmap <Icon name="arrow" size={18} />
        </Link>
      </section>
      <div className="uv-dashboard-lower">
        <section className="uv-next-steps">
          <div className="uv-section-heading">
            <div>
              <Label>SMALL STEPS. REAL MOMENTUM.</Label>
              <h2>Up next.</h2>
            </div>
            <span className="uv-index-note">{pending.length} TO GO</span>
          </div>
          {pending.length ? (
            pending
              .slice(0, 3)
              .map((task) => <TaskRow task={task} key={task.id} done={false} onOpen={onTask} />)
          ) : (
            <div className="uv-empty">
              <TileIcon icon="check" color="mint" />
              <h3>Your checklist is complete.</h3>
              <p>Confirm official completion and any remaining requirements with HR.</p>
            </div>
          )}
          <p className="uv-caption">
            <Icon name="info" size={14} />
            Suggested steps. HR confirms your assigned activities.
          </p>
        </section>
        <aside className="uv-explore-panel">
          <Label>TAKE A LOOK AROUND</Label>
          <Link to={chatPath} navigate={navigate}>
            <span>01</span>
            <div>
              <h3>Ask Alya</h3>
              <p>Company guidance, clear cards and a familiar voice.</p>
            </div>
            <Icon name="arrow" />
          </Link>
          <Link to="/support" navigate={navigate}>
            <span>02</span>
            <div>
              <h3>Find your people</h3>
              <p>A good question starts a conversation.</p>
            </div>
            <Icon name="arrow" />
          </Link>
        </aside>
      </div>
      <div className="uv-stage-overview">
        {stageIntros.map((stage, index) => (
          <Link to="/onboarding" navigate={navigate} key={stage.title}>
            <span>
              0{index + 1} / {stages[index]}
            </span>
            <h3>{stage.title}</h3>
            <p>{stage.text}</p>
            <Icon name="arrow" size={18} />
          </Link>
        ))}
      </div>
    </>
  );
}

function Onboarding({ state, onTask, notify }) {
  const [stage, setStage] = useState(-1),
    [status, setStatus] = useState('all');
  const shown = tasks.filter(
    (task) =>
      (stage === -1 || task.stage === stage) &&
      (status === 'all' ||
        (status === 'done'
          ? state.completed.includes(task.id)
          : !state.completed.includes(task.id))),
  );
  function download() {
    const body = [
      'OnboardAi — MY ONBOARDING',
      'Suggested checklist. HR confirms assigned activities.',
      '',
      ...tasks.map(
        (task) =>
          `${state.completed.includes(task.id) ? '[x]' : '[ ]'} ${task.title} — ${stages[task.stage]}`,
      ),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-onboarding-checklist.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Your checklist has been downloaded.');
  }
  return (
    <>
      <PageHeading
        number="01"
        eyebrow="YOUR ROADMAP"
        title={
          <>
            A great start.
            <br />
            <em>One step at a time.</em>
          </>
        }
        description="You don’t have to figure it all out on day one."
      >
        <button className="uv-button secondary" onClick={download}>
          <Icon name="download" size={17} />
          Download checklist
        </button>
      </PageHeading>
      <div className="uv-journey-layout">
        <aside className="uv-journey-sidebar">
          <div className="uv-journey-progress">
            <ProgressRing count={state.completed.length} />
            <p>
              {state.completed.length} of {tasks.length} steps marked done
            </p>
            <small>Your own progress record.</small>
          </div>
          <nav className="uv-stage-list" aria-label="Onboarding stages">
            <button
              className={stage === -1 ? 'active' : ''}
              aria-pressed={stage === -1}
              onClick={() => setStage(-1)}
            >
              <Icon name="checklist" size={19} />
              <span>The full journey</span>
              <small>{tasks.length}</small>
            </button>
            {stages.map((name, index) => {
              const group = tasks.filter((task) => task.stage === index),
                done = group.filter((task) => state.completed.includes(task.id)).length;
              return (
                <button
                  className={stage === index ? 'active' : ''}
                  aria-pressed={stage === index}
                  onClick={() => setStage(index)}
                  key={name}
                >
                  <span className="uv-stage-id">0{index + 1}</span>
                  <span>{name}</span>
                  <small>
                    {done}/{group.length}
                  </small>
                </button>
              );
            })}
          </nav>
        </aside>
        <section className="uv-journey-content">
          <div className="uv-journey-filter">
            <div>
              <Label>{stage === -1 ? 'THE FULL JOURNEY' : stages[stage]}</Label>
              <h2>{stage === -1 ? 'Let’s make a start.' : stageIntros[stage].title}</h2>
            </div>
            <div className="uv-filter-chips" aria-label="Task status">
              {[
                ['all', 'All'],
                ['todo', 'To do'],
                ['done', 'Done'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={status === value ? 'active' : ''}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length ? (
            stage === -1 ? (
              stages.map((name, index) => {
                const group = shown.filter((task) => task.stage === index);
                return group.length ? (
                  <div className="uv-task-group" key={name}>
                    <div className="uv-group-heading">
                      <span>0{index + 1}</span>
                      <h3>{name}</h3>
                      <small>{stageIntros[index].text}</small>
                    </div>
                    {group.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        done={state.completed.includes(task.id)}
                        onOpen={onTask}
                      />
                    ))}
                  </div>
                ) : null;
              })
            ) : (
              <div className="uv-task-group">
                {shown.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    done={state.completed.includes(task.id)}
                    onOpen={onTask}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="uv-empty">
              <Icon name="checklist" size={34} />
              <h3>No steps in this view.</h3>
              <p>Choose a different stage or status.</p>
              <button
                className="uv-button secondary"
                onClick={() => {
                  setStage(-1);
                  setStatus('all');
                }}
              >
                Show all steps
              </button>
            </div>
          )}
          <p className="uv-caption">
            <Icon name="info" size={15} />
            Times are estimates. Marking a step done does not submit it for HR approval.
          </p>
        </section>
      </div>
    </>
  );
}

function Support({ state, onNote, onDelete, notify, initialTeam }) {
  const [team, setTeam] = useState(initialTeam || 'manager'),
    [text, setText] = useState(''),
    [expanded, setExpanded] = useState(initialTeam || 'manager');
  const formRef = useRef(null);
  useEffect(() => {
    if (initialTeam) {
      setTeam(initialTeam);
      setExpanded(initialTeam);
      formRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [initialTeam]);
  function prepare(id) {
    setTeam(id);
    formRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'center',
    });
    formRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }
  function save(event) {
    event.preventDefault();
    if (!text.trim()) return;
    onNote({ id: Date.now().toString(), team, text: text.trim(), date: new Date().toISOString() });
    setText('');
    notify('Note saved on this device. Share it through your company support channel.');
  }
  async function copy(note) {
    try {
      await navigator.clipboard.writeText(note.text);
      notify('Support note copied.');
    } catch {
      notify('Select the note text to copy it manually.');
    }
  }
  return (
    <>
      <PageHeading
        number="02"
        eyebrow="YOUR PEOPLE"
        title={
          <>
            You’ve got questions.
            <br />
            <em>We’ve got people.</em>
          </>
        }
        description="Knowing who to ask makes a new place feel familiar."
      />
      <div className="uv-people-layout">
        <aside className="uv-people-intro">
          <div className="uv-people-symbol" aria-hidden="true">
            <span>U</span>
            <span>+</span>
            <span>US</span>
          </div>
          <Label>START A CONVERSATION</Label>
          <h2>
            A little help.
            <br />A big difference.
          </h2>
          <p>
            Start with your manager or buddy. They can introduce you to the right person and confirm
            current contacts.
          </p>
          <span className="uv-people-status">
            <span className="uv-small-dot mint" /> CONTACTS CONFIRMED BY YOUR TEAM
          </span>
        </aside>
        <div className="uv-directory">
          {supportTeams.map((item, index) => (
            <section
              className={'uv-person ' + (expanded === item.id ? 'expanded' : '')}
              key={item.id}
            >
              <button
                className="uv-person-heading"
                aria-expanded={expanded === item.id}
                aria-controls={'team-' + item.id}
                onClick={() => setExpanded(expanded === item.id ? null : item.id)}
              >
                <span className="uv-person-index">0{index + 1}</span>
                <TileIcon icon={item.icon} color={item.color} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <Icon name={expanded === item.id ? 'close' : 'down'} size={20} />
              </button>
              <div
                id={'team-' + item.id}
                hidden={expanded !== item.id}
                className="uv-person-details"
              >
                <div className="uv-topic-list">
                  {item.topics.map((topic) => (
                    <span key={topic}>{topic}</span>
                  ))}
                </div>
                <p>{item.instruction}</p>
                <button className="uv-text-link" onClick={() => prepare(item.id)}>
                  Prepare your question <Icon name="arrow" size={18} />
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
      <div className="uv-support-note-grid">
        <section className="uv-support-form" ref={formRef}>
          <Label>A CLEAR QUESTION IS A GOOD START</Label>
          <h2>Put it into words.</h2>
          <p>Save a note here, then share it through the company’s approved support channel.</p>
          <form onSubmit={save}>
            <label>
              Who is this for?
              <select value={team} onChange={(event) => setTeam(event.target.value)}>
                {supportTeams.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Your question
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                maxLength={1200}
                placeholder="What do you need help with?"
                required
              />
            </label>
            <p className="uv-form-hint">
              <Icon name="shield" size={15} />
              No passwords or private employee information. Notes stay on this device and are not
              sent.
            </p>
            <button className="uv-button primary" disabled={!text.trim()}>
              Save support note <Icon name="arrow" size={18} />
            </button>
          </form>
        </section>
        <aside className="uv-saved-notes">
          <div className="uv-section-heading">
            <h2>Your notes.</h2>
            <span>{state.notes.length.toString().padStart(2, '0')}</span>
          </div>
          {state.notes.length ? (
            state.notes.map((note) => (
              <article className="uv-saved-note" key={note.id}>
                <Label>{supportTeams.find((item) => item.id === note.team)?.title}</Label>
                <p>{note.text}</p>
                <div>
                  <button onClick={() => copy(note)}>
                    <Icon name="copy" size={14} />
                    Copy
                  </button>
                  <button onClick={() => onDelete(note.id)}>Delete</button>
                </div>
              </article>
            ))
          ) : (
            <div className="uv-note-empty">
              <Icon name="chat" size={36} />
              <h3>
                A blank page.
                <br />A fresh conversation.
              </h3>
              <p>Your saved questions will appear here.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function AssistantPage({ navigate, guestId, accountId = '' }) {
  return (
    <React.Suspense
      fallback={
        <div className="uv-empty">
          <Icon name="spark" size={30} />
          <h1>Getting Alya ready…</h1>
        </div>
      }
    >
      <AlyaChatPage
        key={(guestId || 'company') + (accountId || '')}
        navigate={navigate}
        guestId={guestId}
      />
    </React.Suspense>
  );
}

function ProfileModal({ profile, onSave, onClose }) {
  const [draft, setDraft] = useState({ ...profile });
  return (
    <Modal title="Make this space yours" onClose={onClose}>
      <p className="uv-dialog-intro">
        Use your preferred name and confirm your joining details with HR. Your profile stays on this
        device.
      </p>
      <form
        className="uv-profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...draft, name: draft.name.trim() });
        }}
      >
        <label>
          Preferred name
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            maxLength={40}
            placeholder="How should we welcome you?"
            autoComplete="off"
            autoFocus
          />
        </label>
        <label>
          Onboarding pathway
          <select
            value={draft.pathway}
            onChange={(event) => setDraft({ ...draft, pathway: event.target.value })}
          >
            <option>Employee</option>
            <option>Intern</option>
            <option>Contractor</option>
          </select>
        </label>
        <label>
          Joining date
          <input
            type="date"
            value={draft.startDate}
            onInput={(event) => setDraft({ ...draft, startDate: event.target.value })}
            onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
          />
        </label>
        <div className="uv-form-actions">
          <button type="button" className="uv-button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="uv-button primary">
            Save my profile <Icon name="check" size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SearchModal({ onClose, navigate, onTask }) {
  const [query, setQuery] = useState('');
  const entries = [
    ...navigation.map((item) => ({
      title: item.label,
      type: 'Page',
      icon: item.icon,
      path: item.path,
    })),
    ...tasks.map((task) => ({
      title: task.title,
      type: 'Task',
      icon: 'checklist',
      task,
      keywords: task.description,
    })),
  ];
  const results = query.trim()
    ? entries
        .filter((item) =>
          (item.title + ' ' + (item.keywords || ''))
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
        )
        .slice(0, 9)
    : entries.slice(0, 6);
  return (
    <Modal title="Find your next step" onClose={onClose} wide>
      <div className="uv-command-input">
        <Icon name="search" />
        <input
          aria-label="Search tasks and pages"
          placeholder="Search your workspace…"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <p className="uv-search-caption">{query ? 'MATCHING RESULTS' : 'QUICK NAVIGATION'}</p>
      <div className="uv-search-results">
        {results.map((item) => (
          <button
            key={item.type + item.title}
            onClick={() => (item.task ? onTask(item.task) : navigate(item.path))}
          >
            <TileIcon icon={item.icon} />
            <span>
              {item.title}
              <small>{item.type}</small>
            </span>
            <Icon name="arrow" size={17} />
          </button>
        ))}
        {!results.length && (
          <div className="uv-empty">
            <h3>No results for “{query}”</h3>
            <p>Try a short topic such as tools, team or profile.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function OnboardingWebsite() {
  const [path, setPath] = useState(window.location.pathname),
    [state, setState] = useState(readState),
    [dialog, setDialog] = useState(null),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(''),
    [supportTeam, setSupportTeam] = useState(null),
    [guestPreview, setGuestPreview] = useState('');
  const mainRef = useRef(null),
    toastTimer = useRef(null);
  const session = useAccountSession({ onNavigate: (to) => navigate(to) });
  const account = session.account;
  const navItems =
    account?.role === 'employee'
      ? [...navigation, { path: '/profile', label: 'My profile', short: 'Profile', icon: 'user' }]
      : navigation;
  const decision = routeDecision({
    accounts: session.accounts,
    loading: session.loading,
    account,
    path,
  });
  const guestId = path.match(/^\/(?:guest\/employee|employee)\/([a-f0-9-]{36})$/i)?.[1];
  const assistantPath = path === '/mira' || !!guestId;
  const chatPath = guestId || path === '/mira' ? path : account ? '/mira' : '/employee';
  const active = navItems.find((item) => item.path === (assistantPath ? '/mira' : path));
  useEffect(() => {
    const pop = () => {
      let next = window.location.pathname;
      if (next === '/guide' || next.startsWith('/guide/')) {
        next = '/mira';
        window.history.replaceState({}, '', next);
      }
      if (['/chat', '/avatar-preview', '/about', '/resources'].includes(next)) {
        next = '/mira';
        window.history.replaceState({}, '', next);
      }
      setPath(next);
      setDialog(null);
      setMobile(false);
      setSupportTeam(null);
    };
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    const accessTitle =
      path === '/' || path === '/login'
        ? 'Welcome'
        : path === '/signup'
          ? 'Create an employee account'
          : ['/hr', '/hr-preview'].includes(path)
            ? 'HR workspace'
            : null;
    document.title = (accessTitle || active?.label || 'Page not found') + ' · OnboardAi';
  }, [path, account?.role]);
  useEffect(() => {
    // Sign-in state decides some landing pages; replace so Back does not loop.
    if (decision.type !== 'redirect' || decision.to === path) return;
    window.history.replaceState({}, '', decision.to);
    setPath(decision.to);
    setGuestPreview('');
  }, [decision.type, decision.to, path]);
  useEffect(() => {
    const keys = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDialog({ type: 'search' });
      }
      if (event.key === 'Escape') setMobile(false);
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, []);
  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }
  function update(next) {
    setState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      notify('Your changes are visible, but this browser could not save them.');
    }
  }
  function navigate(next) {
    if (next !== path) window.history.pushState({}, '', next);
    setPath(next);
    setMobile(false);
    setDialog(null);
    setSupportTeam(null);
    if (['/', '/login', '/signup'].includes(next)) setGuestPreview('');
    window.scrollTo({ top: 0, behavior: 'instant' });
    mainRef.current?.focus({ preventScroll: true });
  }
  function toggleTask(task) {
    const done = state.completed.includes(task.id);
    update({
      ...state,
      completed: done
        ? state.completed.filter((id) => id !== task.id)
        : [...state.completed, task.id],
    });
    setDialog(null);
    notify(
      done
        ? 'Step moved back to your to-do list.'
        : 'Marked done on this device. HR verifies official completion.',
    );
  }
  const onTask = (task) => setDialog({ type: 'task', task }),
    name = state.profile.name || 'Your profile';
  if (decision.type === 'loading' || decision.type === 'redirect')
    return (
      <main className="uv-empty" aria-busy="true">
        <p role="status">Loading…</p>
      </main>
    );
  if (decision.type === 'change-password')
    return (
      <ChangePasswordPage
        account={account}
        onSignOut={session.signOut}
        onChangePassword={async (current, next) => {
          const updated = await session.changePassword(current, next);
          navigate(landingPath(updated));
        }}
      />
    );
  if (['/', '/login', '/signup'].includes(path))
    return (
      <LoginPage
        signup={path === '/signup'}
        accounts={session.accounts === true}
        onSignIn={session.signIn}
        sessionNotice={session.notice}
        navigate={navigate}
        onGuest={(role) => {
          setGuestPreview(role);
          navigate(role === 'hr' ? '/hr' : '/dashboard');
        }}
      />
    );
  if (['/hr', '/hr-preview'].includes(path))
    return <HrWorkspace navigate={navigate} account={account} onSignOut={session.signOut} />;
  if (['/employee', '/guest/employee'].includes(path))
    return <GuestEmployeeEntry navigate={navigate} />;
  return (
    <div className={'uv-portal' + (assistantPath ? ' uv-assistant-workspace' : '')}>
      <a className="uv-skip-link" href="#uv-main">
        Skip to content
      </a>
      <header className="uv-header">
        <div className="uv-header-top">
          <Link
            to="/dashboard"
            navigate={navigate}
            className="uv-brand-link"
            aria-label="OnboardAi dashboard"
          >
            <Brand />
          </Link>
          <span className="uv-header-caption">A NEW CHAPTER. A SHARED UNIVERSE.</span>
          <div className="uv-header-actions">
            <span className="uv-preview-label">
              <span className="uv-small-dot mint" />
              {guestId || guestPreview === 'employee' || account ? 'EMPLOYEE' : 'WORKSPACE'}
            </span>
            {account ? (
              <>
                <span className="uv-account-id">
                  Signed in as <strong>{account.username}</strong>
                </span>
                <button type="button" className="uv-access-link" onClick={session.signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/login" navigate={navigate} className="uv-access-link">
                Back to sign in <Icon name="arrow" size={14} />
              </Link>
            )}
            <button
              className="uv-icon-button"
              aria-label="Search your workspace"
              onClick={() => setDialog({ type: 'search' })}
            >
              <Icon name="search" size={21} />
            </button>
            <button
              className="uv-profile-top"
              aria-label="Edit my profile"
              title={name}
              onClick={() => setDialog({ type: 'profile' })}
            >
              {state.profile.name ? (
                state.profile.name[0].toUpperCase()
              ) : (
                <Icon name="user" size={18} />
              )}
            </button>
            <button
              className="uv-icon-button uv-menu-button"
              aria-label={mobile ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobile}
              aria-controls="uv-nav"
              onClick={() => setMobile(!mobile)}
            >
              <Icon name={mobile ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
        <nav
          id="uv-nav"
          className={'uv-navigation ' + (mobile ? 'is-open' : '')}
          aria-label="Main navigation"
        >
          {navItems.map((item, index) => (
            <Link
              to={item.path === '/mira' ? chatPath : item.path}
              navigate={navigate}
              key={item.path}
              aria-current={active?.path === item.path ? 'page' : undefined}
              className={'uv-nav-item ' + (active?.path === item.path ? 'active' : '')}
            >
              <span className="uv-nav-number">0{index}</span>
              <span>{item.label}</span>
              {item.soon && <small>SOON</small>}
              <Icon name="arrow" size={15} />
            </Link>
          ))}
        </nav>
      </header>
      <main className="uv-main" id="uv-main" tabIndex={-1} ref={mainRef}>
        {path === '/dashboard' ? (
          <Dashboard
            chatPath={chatPath}
            state={state}
            navigate={navigate}
            onTask={onTask}
            onProfile={() => setDialog({ type: 'profile' })}
          />
        ) : path === '/onboarding' ? (
          <Onboarding state={state} onTask={onTask} notify={notify} />
        ) : path === '/support' ? (
          <Support
            state={state}
            initialTeam={supportTeam}
            onNote={(note) => update({ ...state, notes: [note, ...state.notes].slice(0, 10) })}
            onDelete={(id) => {
              update({ ...state, notes: state.notes.filter((note) => note.id !== id) });
              notify('Support note deleted.');
            }}
            notify={notify}
          />
        ) : path === '/profile' && account ? (
          <MyProfilePage account={account} />
        ) : assistantPath ? (
          <AssistantPage navigate={navigate} guestId={guestId} accountId={account?.id} />
        ) : (
          <div className="uv-empty">
            <Label>404 / UNEXPLORED SPACE</Label>
            <h1>This page hasn’t landed yet.</h1>
            <Link to="/" navigate={navigate} className="uv-button primary">
              Return home <Icon name="arrow" size={18} />
            </Link>
          </div>
        )}
        {!assistantPath && (
          <footer className="uv-footer">
            <Brand />
            <span>YOUR NEXT CHAPTER STARTS WITH YOU.</span>
            <span>OnboardAi / PREVIEW</span>
          </footer>
        )}
      </main>
      {!assistantPath && (
        <Link to={chatPath} navigate={navigate} className="alya-assistant-entry">
          <span>A</span>
          <div>
            Ask Alya<small>Your onboarding companion</small>
          </div>
          <Icon name="chat" size={19} />
        </Link>
      )}
      {toast && (
        <div className="uv-toast" role="status">
          <Icon name="check" size={18} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <Icon name="close" size={17} />
          </button>
        </div>
      )}
      {dialog?.type === 'profile' && (
        <ProfileModal
          profile={state.profile}
          onClose={() => setDialog(null)}
          onSave={(profile) => {
            update({ ...state, profile });
            setDialog(null);
            notify('Your profile is saved on this device.');
          }}
        />
      )}
      {dialog?.type === 'search' && (
        <SearchModal onClose={() => setDialog(null)} navigate={navigate} onTask={onTask} />
      )}
      {dialog?.type === 'task' && (
        <Modal title="Your next step" onClose={() => setDialog(null)}>
          <div className="uv-task-detail">
            <Label>{stages[dialog.task.stage]}</Label>
            <h3>{dialog.task.title}</h3>
            <p>{dialog.task.description}</p>
            <div className="uv-task-metadata">
              <span>
                <Icon name="clock" size={16} />
                {dialog.task.time} estimated
              </span>
              <span>
                <Icon name="user" size={16} />
                {dialog.task.owner}
              </span>
            </div>
            <h4>WHAT TO DO</h4>
            <ol>
              {dialog.task.steps.map((step, index) => (
                <li key={step}>
                  <span>0{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
            <button
              className="uv-button secondary"
              onClick={() =>
                dialog.task.target === 'profile'
                  ? setDialog({ type: 'profile' })
                  : navigate(dialog.task.target)
              }
            >
              {dialog.task.action}
              <Icon name="arrow" size={17} />
            </button>
            <div className="uv-task-detail-bottom">
              <p>
                Your own progress record.
                <br />
                HR verifies official completion.
              </p>
              <button className="uv-button primary" onClick={() => toggleTask(dialog.task)}>
                <Icon
                  name={state.completed.includes(dialog.task.id) ? 'checklist' : 'check'}
                  size={17}
                />
                {state.completed.includes(dialog.task.id) ? 'Move back to to do' : 'Mark as done'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
