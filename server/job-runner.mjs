// Own the entire database lifetime, including failures while opening or closing.
// Work-specific progress and safe error messages remain with the caller.
export async function runDatabaseJob({openDatabase, job, signal, run, failureMessage, cancelledMessage}) {
  let db;
  let failure;
  try {
    signal.throwIfAborted();
    db = openDatabase();
    await run(db, job, signal);
  } catch (error) {
    failure = error;
  } finally {
    try { db?.close(); }
    catch (error) { failure ??= error; }
    if (failure) {
      job.status = signal.aborted ? 'cancelled' : 'failed';
      job.message = signal.aborted ? cancelledMessage : failureMessage(failure);
    }
    job.finishedAt = new Date().toISOString();
  }
  return job;
}
