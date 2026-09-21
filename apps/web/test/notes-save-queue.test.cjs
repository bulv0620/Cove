const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSaveQueue() {
  const context = { exports: {} };
  const source = fs.readFileSync(
    path.join(__dirname, '../src/features/notes/save-queue.ts'),
    'utf8',
  );
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  return context.exports.SaveQueue;
}

const SaveQueue = loadSaveQueue();

/** Deterministic clock: schedules run only when advance() reaches them. */
function createClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const schedule = (fn, ms) => {
    const id = ++sequence;
    timers.set(id, { fn, at: now + ms, cancelled: false });
    return () => {
      const timer = timers.get(id);
      if (timer) timer.cancelled = true;
    };
  };
  const advance = (ms) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.values()]
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = Math.max(now, due.at);
      due.cancelled = true;
      due.fn();
    }
    now = target;
  };
  return { schedule, advance, now: () => now };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Queue with injected clock; every commit parks on a deferred the test resolves. */
function makeQueue(options = {}) {
  const clock = createClock();
  const events = { commits: [], drafts: [], clears: 0, snapshots: [] };
  let gate = null;
  let requestSequence = 0;
  const queue = new SaveQueue({
    ...options,
    now: clock.now,
    schedule: clock.schedule,
    persistDraft: (markdown, revision) => events.drafts.push({ markdown, revision }),
    clearDraft: () => {
      events.clears += 1;
    },
    requestId: () => `request-${++requestSequence}`,
    commit: (markdown, expectedRevision, requestId) => {
      gate = deferred();
      events.commits.push({ markdown, expectedRevision, requestId, gate });
      return gate.promise;
    },
    onSnapshot: (snapshot) => events.snapshots.push({ ...snapshot }),
  });
  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { queue, clock, events, gate: () => gate, settle };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('debounce merges rapid edits into one commit with the newest text', async () => {
  const { queue, clock, events, gate, settle } = makeQueue();
  queue.start('# hi', 'rev-1');
  queue.edit('# hi ');
  clock.advance(200);
  queue.edit('# hi there');
  clock.advance(2499);
  assert.equal(events.commits.length, 0, 'the debounce window restarts on every edit');
  clock.advance(1);
  assert.equal(events.commits.length, 1);
  assert.equal(events.commits[0].markdown, '# hi there');
  assert.equal(events.commits[0].expectedRevision, 'rev-1');
  gate().resolve({ revision: 'rev-2' });
  await settle();
  assert.equal(events.snapshots.at(-1).phase, 'clean');
  assert.ok(
    events.snapshots.some((snapshot) => snapshot.phase === 'saved'),
    'a transient saved phase is reported',
  );
});

test('a draft is persisted 500 ms into an edit burst', async () => {
  const { queue, clock, events } = makeQueue();
  queue.start('body', 'rev-1');
  queue.edit('body!');
  clock.advance(500);
  assert.deepEqual(events.drafts, [{ markdown: 'body!', revision: 'rev-1' }]);
  assert.equal(events.snapshots.at(-1).phase, 'draft');
});

test('continuous typing never commits later than the 30 s hold cap', async () => {
  const { queue, clock, events } = makeQueue();
  queue.start('x', 'rev-1');
  queue.edit('x1');
  for (let index = 1; index <= 299; index += 1) {
    clock.advance(100);
    queue.edit(`x${index + 1}`);
  }
  assert.equal(events.commits.length, 0, 'sliding debounce keeps deferring');
  clock.advance(100); // t = 30 000 ms since the first edit
  assert.equal(events.commits.length, 1);
  assert.equal(events.commits[0].markdown, 'x300');
});

test('flush commits immediately and resolves after the save settles', async () => {
  const { queue, clock, events, gate } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  let flushed = false;
  const done = queue.flush().then(() => {
    flushed = true;
  });
  await tick();
  assert.equal(events.commits.length, 1, 'flush skips the debounce');
  assert.equal(flushed, false);
  assert.equal(clock.now(), 0, 'no clock time needed');
  gate().resolve({ revision: 'rev-2' });
  await tick();
  await done;
  assert.equal(flushed, true);
  assert.equal(events.snapshots.at(-1).phase, 'clean');
  assert.ok(events.snapshots.some((snapshot) => snapshot.phase === 'saved'));
});

test('flush while a save is in flight commits the newest text afterwards', async () => {
  const { queue, events, gate, settle } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  const first = queue.flush();
  await tick();
  queue.edit('abc');
  const second = queue.flush();
  gate().resolve({ revision: 'rev-2' });
  await settle();
  assert.equal(events.commits.length, 2, 'newer text commits after the in-flight save');
  assert.equal(events.commits[1].markdown, 'abc');
  assert.equal(events.commits[1].expectedRevision, 'rev-2');
  gate().resolve({ revision: 'rev-3' });
  await settle();
  await Promise.all([first, second]);
});

test('typing during a save reschedules one follow-up commit', async () => {
  const { queue, clock, events, gate, settle } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  clock.advance(2500);
  queue.edit('abc');
  gate().resolve({ revision: 'rev-2' });
  await settle();
  assert.equal(events.commits.length, 1);
  clock.advance(2499);
  assert.equal(events.commits.length, 1);
  clock.advance(1);
  assert.equal(events.commits.length, 2);
  assert.equal(events.commits[1].markdown, 'abc');
});

test('editing back to the saved text clears the draft and saves nothing', async () => {
  const { queue, clock, events } = makeQueue();
  queue.start('keep', 'rev-1');
  queue.edit('changed');
  clock.advance(500);
  assert.equal(events.drafts.length, 1);
  queue.edit('keep');
  assert.equal(events.clears, 1);
  assert.equal(events.snapshots.at(-1).phase, 'clean');
  clock.advance(60_000);
  assert.equal(events.commits.length, 0);
});

test('a successful commit updates the revision and clears the draft', async () => {
  const { queue, clock, events, gate, settle } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  clock.advance(2500);
  gate().resolve({ revision: 'rev-2' });
  await settle();
  assert.equal(events.clears, 1);
  queue.edit('abc');
  clock.advance(2500);
  assert.equal(events.commits[1].expectedRevision, 'rev-2');
  gate().resolve({ revision: 'rev-3' });
  await settle();
});

test('identical repeated content is not written again', async () => {
  const { queue, clock, events, gate, settle } = makeQueue();
  queue.start('same', 'rev-1');
  queue.edit('same');
  clock.advance(60_000);
  assert.equal(events.commits.length, 0);
  queue.edit('different');
  clock.advance(2500);
  gate().resolve({ revision: 'rev-2' });
  await settle();
  queue.edit('different');
  clock.advance(60_000);
  assert.equal(events.commits.length, 1);
});

test('NOTE_CHANGED freezes autosave into the conflict phase', async () => {
  const { queue, clock, events, gate, settle } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  clock.advance(2500);
  const failure = new Error('NOTE_CHANGED');
  failure.code = 'NOTE_CHANGED';
  gate().reject(failure);
  await settle();
  assert.equal(events.snapshots.at(-1).phase, 'conflict');
  assert.equal(events.snapshots.at(-1).errorCode, 'NOTE_CHANGED');
  queue.edit('abc'); // local editing continues, but SMB autosave stays frozen
  clock.advance(500);
  assert.deepEqual(events.drafts.at(-1), { markdown: 'abc', revision: 'rev-1' });
  clock.advance(59_500);
  assert.equal(events.commits.length, 1);
  await queue.retry(); // conflicts need explicit resolution, not a blind retry
  assert.equal(events.commits.length, 1);
});

test('a restored draft commits against its original revision', async () => {
  const { queue, clock, events } = makeQueue();
  queue.start('NAS changed', 'rev-current');
  queue.restoreDraft('local draft', 'rev-draft-base');
  clock.advance(2500);
  assert.equal(events.commits.length, 1);
  assert.equal(events.commits[0].expectedRevision, 'rev-draft-base');
  assert.equal(events.commits[0].markdown, 'local draft');
});

test('a legacy draft without a revision stays editable but never overwrites NAS', async () => {
  const { queue, clock, events } = makeQueue();
  queue.start('NAS changed', 'rev-current');
  queue.restoreDraft('legacy draft');
  assert.equal(queue.snapshot().phase, 'conflict');
  queue.edit('legacy draft edited');
  clock.advance(500);
  assert.deepEqual(events.drafts.at(-1), {
    markdown: 'legacy draft edited',
    revision: 'rev-current',
  });
  clock.advance(60_000);
  assert.equal(events.commits.length, 0);
});

test('transient failures stay retryable and recover', async () => {
  const { queue, clock, events, gate, settle } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  clock.advance(2500);
  const failure = new Error('SMB_UNAVAILABLE');
  failure.code = 'SMB_UNAVAILABLE';
  gate().reject(failure);
  await settle();
  assert.equal(events.snapshots.at(-1).phase, 'failed');
  const retried = queue.retry();
  await tick();
  assert.equal(events.commits.length, 2);
  assert.equal(events.commits[1].expectedRevision, 'rev-1', 'retry reuses the last known revision');
  assert.notEqual(events.commits[1].requestId, events.commits[0].requestId);
  gate().resolve({ revision: 'rev-2' });
  await settle();
  await retried;
  assert.equal(events.snapshots.at(-1).phase, 'clean');
  assert.ok(events.snapshots.some((snapshot) => snapshot.phase === 'saved'));
});

test('an ambiguous transport failure reuses the request id on retry', async () => {
  const { queue, clock, events, gate, settle } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  clock.advance(2500);
  gate().reject(new Error('network disconnected'));
  await settle();
  const retried = queue.retry();
  await tick();
  assert.equal(events.commits[1].requestId, events.commits[0].requestId);
  gate().resolve({ revision: 'rev-2' });
  await settle();
  await retried;
});

test('dispose stops timers; edits after disposal are ignored', async () => {
  const { queue, clock, events } = makeQueue();
  queue.start('a', 'rev-1');
  queue.edit('ab');
  queue.dispose();
  queue.edit('abc');
  clock.advance(60_000);
  assert.equal(events.commits.length, 0);
  assert.equal(events.drafts.length, 0);
});

test('manual mode never commits on its own', () => {
  const { queue, clock, events } = makeQueue({ autoSave: false });
  queue.start('# hi', 'rev-1');
  queue.edit('# hi there');
  clock.advance(60_000);
  assert.equal(events.commits.length, 0, 'typing never reaches the NAS without a save');
  assert.equal(events.drafts.length, 0, 'no recovery draft is written on a timer');
  assert.equal(queue.snapshot().dirty, true);
  assert.equal(queue.snapshot().phase, 'pending');
});

test('manual mode commits exactly once when the user saves', async () => {
  const { queue, clock, events, gate, settle } = makeQueue({ autoSave: false });
  queue.start('a', 'rev-1');
  queue.edit('ab');
  clock.advance(60_000);
  assert.equal(events.commits.length, 0);
  const saving = queue.flush();
  await tick();
  assert.equal(events.commits.length, 1);
  assert.equal(events.commits[0].markdown, 'ab');
  gate().resolve({ revision: 'rev-2' });
  await settle();
  await saving;
  assert.equal(queue.snapshot().dirty, false);
  assert.ok(events.snapshots.some((snapshot) => snapshot.phase === 'saved'));
});

test('manual mode keeps failed saves dirty and does not retry in the background', async () => {
  const { queue, clock, events, gate, settle } = makeQueue({ autoSave: false });
  queue.start('a', 'rev-1');
  queue.edit('ab');
  clock.advance(60_000);
  const saving = queue.flush();
  await tick();
  const failure = new Error('SMB_UNAVAILABLE');
  failure.code = 'SMB_UNAVAILABLE';
  gate().reject(failure);
  await settle();
  await saving;
  assert.equal(queue.snapshot().phase, 'failed');
  assert.equal(queue.snapshot().dirty, true, 'the text is still unsaved');
  assert.equal(queue.current(), 'ab');
  clock.advance(60_000);
  assert.equal(events.commits.length, 1, 'only another explicit save tries again');
});

test('manual mode keeps edits made during a save pending until the next save', async () => {
  const { queue, clock, events, gate, settle } = makeQueue({ autoSave: false });
  queue.start('a', 'rev-1');
  queue.edit('ab');
  const saving = queue.flush();
  await tick();
  queue.edit('abc');
  gate().resolve({ revision: 'rev-2' });
  await settle();
  await saving;
  clock.advance(60_000);
  assert.equal(events.commits.length, 1);
  assert.equal(queue.snapshot().dirty, true, 'the newer text stays unsaved');
  assert.equal(queue.snapshot().phase, 'pending');
  const next = queue.flush();
  await tick();
  assert.equal(events.commits.length, 2);
  assert.equal(events.commits[1].markdown, 'abc');
  assert.equal(events.commits[1].expectedRevision, 'rev-2');
  gate().resolve({ revision: 'rev-3' });
  await settle();
  await next;
  assert.equal(queue.snapshot().dirty, false);
});

test('manual mode leaves a restored draft dirty until an explicit save', () => {
  const { queue, clock, events } = makeQueue({ autoSave: false });
  queue.start('stored', 'rev-1');
  queue.restoreDraft('draft text', 'rev-1');
  assert.equal(queue.snapshot().dirty, true);
  assert.equal(queue.snapshot().phase, 'pending');
  clock.advance(60_000);
  assert.equal(events.commits.length, 0);
  assert.equal(events.drafts.length, 0);
});

test('re-opening a queue after dispose revives it (React StrictMode remount)', async () => {
  const { queue, clock, events, gate, settle } = makeQueue({ autoSave: false });
  queue.start('a', 'rev-1');
  // StrictMode runs an extra unmount/mount cycle in development; the queue
  // lives in component state, so the same instance is mounted again.
  queue.dispose();
  queue.edit('ab');
  clock.advance(60_000);
  assert.equal(events.commits.length, 0);
  assert.equal(queue.snapshot().dirty, false, 'a disposed queue still ignores edits');

  queue.start('a', 'rev-1');
  queue.edit('ab');
  assert.equal(queue.snapshot().dirty, true, 'the re-opened queue records edits again');
  const saving = queue.flush();
  await tick();
  assert.equal(events.commits.length, 1);
  gate().resolve({ revision: 'rev-2' });
  await settle();
  await saving;
  assert.equal(queue.snapshot().dirty, false);
});
