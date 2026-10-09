import test from 'node:test';
import assert from 'node:assert/strict';
import {runDatabaseJob} from '../server/job-runner.mjs';

function fixture(overrides = {}) {
  const controller = new AbortController();
  const job = {status: 'running', completed: 0, rows: 0};
  let closed = 0;
  const db = {close() { closed++; }};
  const options = {
    openDatabase: () => db, job, signal: controller.signal,
    run: async (_db, current) => { current.status = 'completed'; current.completed = 1; },
    failureMessage: error => `failed: ${error.message}`, cancelledMessage: 'cancelled',
    ...overrides,
  };
  return {options, controller, job, db, closed: () => closed};
}
const finished = job => assert.ok(Number.isFinite(Date.parse(job.finishedAt)));

test('successful and needs-review jobs close the database and record completion', async () => {
  for (const status of ['completed', 'needs_review']) {
    const f = fixture({run: async (_db, job) => { job.status = status; job.rows = 3; }});
    assert.equal(await runDatabaseJob(f.options), f.job);
    assert.equal(f.job.status, status);
    assert.equal(f.job.rows, 3);
    assert.equal(f.closed(), 1);
    finished(f.job);
  }
});
test('database open failure becomes a finished failed job instead of a rejected background promise', async () => {
  let ran = false;
  const f = fixture({openDatabase: () => { throw new Error('open'); }, run: () => { ran = true; }});
  await runDatabaseJob(f.options);
  assert.equal(f.job.status, 'failed');
  assert.equal(f.job.message, 'failed: open');
  assert.equal(ran, false);
  assert.equal(f.closed(), 0);
  finished(f.job);
});
test('worker failure closes the database and retains committed progress', async () => {
  const f = fixture({run: async (_db, job) => { job.completed = 2; throw new Error('worker'); }});
  await runDatabaseJob(f.options);
  assert.equal(f.job.message, 'failed: worker');
  assert.equal(f.job.status, 'failed');
  assert.equal(f.job.completed, 2);
  assert.equal(f.closed(), 1);
  finished(f.job);
});
test('close failure changes success to failure without skipping finishedAt', async () => {
  const f = fixture();
  f.db.close = () => { throw new Error('close'); };
  await runDatabaseJob(f.options);
  assert.equal(f.job.status, 'failed');
  assert.equal(f.job.message, 'failed: close');
  finished(f.job);
});
test('a cleanup failure does not mask the original worker error', async () => {
  const f = fixture({run: async () => { throw new Error('original'); }});
  f.db.close = () => { throw new Error('close'); };
  await runDatabaseJob(f.options);
  assert.equal(f.job.message, 'failed: original');
  finished(f.job);
});
test('cancellation preserves progress and closes once; pre-cancelled jobs do not open a database', async () => {
  const f = fixture();
  f.options.run = async (_db, job, signal) => {
    job.completed = 2;
    f.controller.abort();
    signal.throwIfAborted();
  };
  await runDatabaseJob(f.options);
  assert.equal(f.job.status, 'cancelled');
  assert.equal(f.job.message, 'cancelled');
  assert.equal(f.job.completed, 2);
  assert.equal(f.closed(), 1);
  finished(f.job);
  const before = fixture({openDatabase: () => { assert.fail('must not open'); }});
  before.controller.abort();
  await runDatabaseJob(before.options);
  assert.equal(before.job.status, 'cancelled');
  finished(before.job);
});
