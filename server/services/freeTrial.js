// A brand-new candidate account gets 10 free questions to try the platform
// with, tracked per-user and never reset — once used up, they're asked to
// subscribe. This is intentionally separate from the "5 exams/month" free
// allowance shown on the pricing page: that's the ongoing free plan's
// monthly exam quota, this is the one-time first-look trial for someone who
// just signed up and hasn't picked a plan yet. Anyone on a paid plan skips
// this check entirely.

const FREE_QUESTION_LIMIT = 10;

async function ensureTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS free_trial_usage (
      user_id VARCHAR(36) PRIMARY KEY,
      questions_used INT NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

// True if this user currently has an active paid subscription. Reads the
// same user_subscriptions table routes/payments.js writes to — if that
// table doesn't exist yet (fresh install, no payment ever made), everyone
// is correctly treated as free rather than erroring.
async function hasActivePaidPlan(db, userId) {
  try {
    const [rows] = await db.execute(
      `SELECT plan_id, expires_at FROM user_subscriptions WHERE user_id=?`, [userId]
    );
    const sub = rows[0];
    if (!sub || sub.plan_id === 'free') return false;
    if (sub.expires_at && new Date(sub.expires_at) < new Date()) return false;
    return true;
  } catch {
    return false; // table doesn't exist yet, or any other lookup failure — fail open to "free"
  }
}

// Checks remaining free-trial quota without consuming any of it — used to
// short-circuit with an upgrade prompt before ever touching the questions
// table if the trial is already exhausted.
async function getRemainingQuota(db, userId) {
  await ensureTable(db);
  const [rows] = await db.execute('SELECT questions_used FROM free_trial_usage WHERE user_id=?', [userId]);
  const used = rows[0]?.questions_used || 0;
  return Math.max(0, FREE_QUESTION_LIMIT - used);
}

// Consumes up to `count` of the remaining quota (e.g. after a batch of
// questions was actually served to the candidate) and returns how many were
// actually consumed, so the caller can cap what it hands back accordingly.
async function consumeQuota(db, userId, count) {
  await ensureTable(db);
  const remaining = await getRemainingQuota(db, userId);
  const consumed = Math.max(0, Math.min(count, remaining));
  if (consumed > 0) {
    await db.execute(
      `INSERT INTO free_trial_usage (user_id, questions_used) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE questions_used = questions_used + ?`,
      [userId, consumed, consumed]
    );
  }
  return consumed;
}

module.exports = { FREE_QUESTION_LIMIT, hasActivePaidPlan, getRemainingQuota, consumeQuota };
