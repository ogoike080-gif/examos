const { v4: uuidv4 } = require('uuid');

// A candidate counts as "school-enrolled" — already accounted for and paid
// for in bulk by their institution (see routes/candidates.js bulk import) —
// if they have a reg_number or class_name on file. Only self-registered
// candidates (routes/auth.js /register) and anonymous-checkout candidates
// (routes/payments.js finalizePayment) have neither, and are the only ones
// this paywall ever applies to. Staff roles are handled separately by the
// caller (checking req.user.role !== 'candidate'), not here.
function isSchoolEnrolled(user) {
  return !!(user && (user.reg_number || user.class_name));
}

let ensured = false; // only attempt the CREATE TABLE once per server process
async function ensureExamUnlocksTable(db) {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS exam_unlocks (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      exam_body VARCHAR(20) NOT NULL,
      expires_at DATETIME NOT NULL,
      payment_id VARCHAR(36) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_exam_body (user_id, exam_body)
    )
  `);
  ensured = true;
}

// True if `user` can access `examBody` content right now for a reason OTHER
// than remaining free-trial quota — i.e. they never need to be shown the
// paywall for this exam body at all:
//   - not a candidate (staff roles aren't gated by this feature)
//   - a school-enrolled candidate (their institution already paid)
//   - holds the flat 'school' plan directly (rare for an individual, but
//     that plan is still meant to unlock everything, same as before)
//   - specifically unlocked THIS exam_body via the per-exam 'student' plan
//     (see routes/payments.js getStudentPrice / finalizePayment)
// examBody may be null/undefined/'CUSTOM' (general practice, not tied to
// one exam body) — that never matches a specific unlock, so it falls
// through to the caller's normal free-trial-quota handling.
async function hasExamAccess(db, user, examBody) {
  if (!user) return false;
  if (user.role !== 'candidate') return true;
  if (isSchoolEnrolled(user)) return true;

  try {
    const [subRows] = await db.execute(
      `SELECT plan_id, expires_at FROM user_subscriptions WHERE user_id=?`, [user.id]
    );
    const sub = subRows[0];
    if (sub && sub.plan_id === 'school' && (!sub.expires_at || new Date(sub.expires_at) >= new Date())) {
      return true;
    }
  } catch { /* user_subscriptions may not exist yet on a brand-new install */ }

  if (!examBody || examBody === 'CUSTOM') return false;

  try {
    await ensureExamUnlocksTable(db);
    const [rows] = await db.execute(
      `SELECT expires_at FROM exam_unlocks WHERE user_id=? AND exam_body=?`,
      [user.id, String(examBody).toUpperCase()]
    );
    const unlock = rows[0];
    return !!(unlock && new Date(unlock.expires_at) >= new Date());
  } catch {
    return false; // fail closed — an unreadable unlock table shouldn't grant free access
  }
}

// Upserts a 30-day unlock for one exam_body, matching the existing
// user_subscriptions expiry window elsewhere in this app. Called from
// routes/payments.js finalizePayment once a 'student'-plan payment for a
// specific exam_body is confirmed. Paying again for the SAME exam_body
// before it expires simply extends it another 30 days from now, rather
// than stacking — there's only ever one unlock row per (user, exam_body).
async function grantExamUnlock(db, userId, examBody, paymentId) {
  await ensureExamUnlocksTable(db);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const code = String(examBody).toUpperCase();
  await db.execute(
    `INSERT INTO exam_unlocks (id, user_id, exam_body, expires_at, payment_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at=?, payment_id=?`,
    [uuidv4(), userId, code, expiresAt, paymentId, expiresAt, paymentId]
  );
  return expiresAt;
}

// Every currently-unexpired exam_body this user has personally unlocked —
// used by GET /api/payments/subscription so the client can show "WAEC ✓,
// JAMB ✓, University — locked" instead of one blanket paid/unpaid flag.
async function listUnlockedExamBodies(db, userId) {
  try {
    await ensureExamUnlocksTable(db);
    const [rows] = await db.execute(
      `SELECT exam_body, expires_at FROM exam_unlocks WHERE user_id=? AND expires_at >= NOW()`,
      [userId]
    );
    return rows;
  } catch {
    return [];
  }
}

module.exports = { isSchoolEnrolled, hasExamAccess, grantExamUnlock, listUnlockedExamBodies, ensureExamUnlocksTable };
