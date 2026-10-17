import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../portal/Icon';
import { documentTypes, reviewStatuses } from '../../shared/document-submissions.mjs';
import { submissionsApi } from './submissions-api.mjs';
import { dateLabel, Status, Notice, Empty, SubmissionDetail } from './SubmissionParts';
import './documents.css';

const initialFilters = {
  search: '',
  department: '',
  type: '',
  status: '',
  date: '',
  sort: 'newest',
};
export default function HrDocumentSubmissions() {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [temporary, setTemporary] = useState(false),
    [filters, setFilters] = useState(initialFilters),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await submissionsApi.list(true);
      setItems(data.submissions);
      setTemporary(data.temporary);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const focus = () => refresh();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  function filter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }
  const departments = [...new Set(items.map((i) => i.department))].sort();
  const visible = useMemo(
    () =>
      items
        .filter((i) => {
          const query = filters.search.toLowerCase().trim();
          return (
            (!query ||
              [i.employeeName, i.employeeId, i.title, i.fileName].some((v) =>
                v.toLowerCase().includes(query),
              )) &&
            (!filters.department || i.department === filters.department) &&
            (!filters.type || i.type === filters.type) &&
            (!filters.status || i.status === filters.status) &&
            (!filters.date || new Date(i.submittedAt).toLocaleDateString('en-CA') === filters.date)
          );
        })
        .sort((a, b) =>
          filters.sort === 'status'
            ? reviewStatuses.indexOf(a.status) - reviewStatuses.indexOf(b.status) ||
              b.submittedAt.localeCompare(a.submittedAt)
            : filters.sort === 'oldest'
              ? a.submittedAt.localeCompare(b.submittedAt)
              : b.submittedAt.localeCompare(a.submittedAt),
        ),
    [items, filters],
  );
  const pages = Math.max(1, Math.ceil(visible.length / 10)),
    current = Math.min(page, pages),
    filtered = Object.entries(filters).some(([k, v]) => k !== 'sort' && v);
  return (
    <section className="ds-page ds-hr">
      <header className="ds-heading">
        <div>
          <span className="ds-eyebrow">HR WORKSPACE / DOCUMENT MANAGEMENT</span>
          <h1>Employee submissions</h1>
          <p>Review employee documents, share clear feedback and keep every submission moving.</p>
        </div>
        <button className="ds-button" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh submissions'}
        </button>
      </header>
      {temporary && (
        <Notice>
          Local preview · Sample records and files. Uploads and review changes are temporary and
          reset on restart.
        </Notice>
      )}
      <Notice error>{error}</Notice>
      <Notice>{success}</Notice>
      <div className="ds-stats">
        {['Total Submissions', ...reviewStatuses].map((label, index) => (
          <button
            key={label}
            className={'ds-stat ds-stat-' + index + (filters.status === label ? ' is-active' : '')}
            onClick={() => filter('status', index ? label : '')}
            aria-pressed={index ? filters.status === label : !filters.status}
          >
            <span>{label}</span>
            <strong>
              {loading
                ? '—'
                : index
                  ? items.filter((i) => i.status === label).length
                  : items.length}
            </strong>
            <small>
              {index === 0
                ? 'Across all employees'
                : index === 1
                  ? 'Ready for a first look'
                  : index === 2
                    ? 'Review in progress'
                    : index === 3
                      ? 'Review complete'
                      : 'Changes requested'}
            </small>
          </button>
        ))}
      </div>
      <section className="ds-card ds-management">
        <div className="ds-section-heading">
          <div>
            <h2>All submissions</h2>
            <p>Each document is private to the employee and your HR team.</p>
          </div>
          <span className="ds-private">
            <Icon name="book" size={17} />
            {visible.length} records
          </span>
        </div>
        <div className="ds-filters">
          <label className="ds-search">
            Search submissions
            <input
              type="search"
              placeholder="Employee name, ID or document…"
              value={filters.search}
              onChange={(e) => filter('search', e.target.value)}
            />
          </label>
          <label>
            Department
            <select
              value={filters.department}
              onChange={(e) => filter('department', e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Document type
            <select value={filters.type} onChange={(e) => filter('type', e.target.value)}>
              <option value="">All document types</option>
              {documentTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={filters.status} onChange={(e) => filter('status', e.target.value)}>
              <option value="">All statuses</option>
              {reviewStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Submission date
            <input
              type="date"
              value={filters.date}
              onChange={(e) => filter('date', e.target.value)}
            />
          </label>
        </div>
        <div className="ds-filter-summary">
          <span>
            {filtered ? `${visible.length} matching submissions` : 'Showing all submissions'}
            {filtered && (
              <button
                className="ds-text-button"
                onClick={() => {
                  setFilters(initialFilters);
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            )}
          </span>
          <label>
            Sort by{' '}
            <select value={filters.sort} onChange={(e) => filter('sort', e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="status">Review status</option>
            </select>
          </label>
        </div>
        {loading ? (
          <p className="ds-empty" role="status">
            Loading employee submissions…
          </p>
        ) : !visible.length ? (
          <Empty filtered={filtered} />
        ) : (
          <div className="ds-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    'Employee',
                    'Employee ID',
                    'Department',
                    'Document',
                    'Type',
                    'Submitted',
                    'Status',
                    'Actions',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.slice((current - 1) * 10, current * 10).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="ds-person">
                        <span className="ds-avatar">
                          {item.employeeName
                            .split(' ')
                            .map((s) => s[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                        <strong>{item.employeeName}</strong>
                      </div>
                    </td>
                    <td className="ds-nowrap">{item.employeeId}</td>
                    <td>{item.department}</td>
                    <td>
                      <strong>{item.title}</strong>
                      <small>{item.fileName}</small>
                      {item.resubmissionOf && <span className="ds-resubmitted">Resubmitted</span>}
                    </td>
                    <td>{item.type}</td>
                    <td className="ds-nowrap">{dateLabel(item.submittedAt)}</td>
                    <td>
                      <Status status={item.status} />
                    </td>
                    <td>
                      <button
                        className="ds-button ds-review-button"
                        onClick={() => {
                          setSuccess('');
                          setDetail(item);
                        }}
                      >
                        Review <Icon name="arrow" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ds-pagination">
          <span>
            {visible.length
              ? `${(current - 1) * 10 + 1}–${Math.min(current * 10, visible.length)} of ${visible.length}`
              : '0'}{' '}
            submissions
          </span>
          <button
            className="ds-button"
            disabled={current === 1 || loading}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <span>
            {current} / {pages}
          </span>
          <button
            className="ds-button"
            disabled={current === pages || loading}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      </section>
      {detail && (
        <SubmissionDetail
          item={detail}
          hr
          onClose={() => setDetail(null)}
          onUpdated={(updated) => {
            setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
            setSuccess(`Review saved. “${updated.title}” is now ${updated.status.toLowerCase()}.`);
          }}
        />
      )}
    </section>
  );
}
