import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyKey, notesKey, readNotes, writeNotes } from '../../src/portal/support-notes.mjs';

function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
    data,
  };
}
const teams = ['manager', 'hr'];

test('notes are stored per account and never mix between people', () => {
  const s = store();
  assert.equal(writeNotes(s, 'a1', [{ id: 'n1', text: 'hello', team: 'hr' }]), true);
  assert.deepEqual(
    readNotes(s, 'a1', teams).map((n) => n.id),
    ['n1'],
  );
  assert.deepEqual(readNotes(s, 'a2', teams), []);
  assert.ok(s.data.has(notesKey('a1')));
});
test('no account, no notes, nothing written', () => {
  const s = store();
  assert.equal(writeNotes(s, '', [{ id: 'n', text: 't', team: 'hr' }]), false);
  assert.deepEqual(readNotes(s, undefined, teams), []);
  assert.equal(s.data.size, 0);
});
test('the old shared record, with its local profile and pathway, is erased', () => {
  const s = store({ [legacyKey]: JSON.stringify({ profile: { name: 'A', pathway: 'Intern' } }) });
  readNotes(s, 'a1', teams);
  assert.equal(s.data.has(legacyKey), false);
});
test('bad data is dropped and at most 10 notes are kept', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ id: 'n' + i, text: 't', team: 'hr' }));
  const s = store({
    [notesKey('a1')]: JSON.stringify([...many, { id: 5 }, { id: 'x', text: 't', team: 'nope' }]),
  });
  assert.equal(readNotes(s, 'a1', teams).length, 10);
  assert.deepEqual(readNotes(store({ [notesKey('a1')]: '{bad' }), 'a1', teams), []);
  assert.equal(
    writeNotes(
      {
        setItem() {
          throw new Error('full');
        },
      },
      'a1',
      [],
    ),
    false,
  );
});
