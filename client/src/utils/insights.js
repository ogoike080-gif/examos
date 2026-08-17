const { getDB } = require('../models/db');

function safeParseArray(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
  catch { return []; }
}
function safeParseObject(val) {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val;
  if (!val) return {};
  try { return JSON.parse(val); } catch { return {}; }
}
function normalise(str) {
  if (str === null || str === undefined) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}
function extractAnswer(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && !Array.isArray(raw) && raw.answer !== undefined)
    return String(raw.answer);
  return String(raw);
}

/**
 * Builds a per-subject and per-topic-tag accuracy breakdown for a candidate,
 * across every submitted exam session they have. This is the data behind
 * both the student-facing "Mistake Detective" and the Parent Dashboard.
 */
async function buildCandidateInsights(candidateId) {
  const db = getDB();

  const [sessions] = await db.execute(
    `SELECT es.id, es.answers, es.score, es.percentage, es.submitted_at, es.exam_id,
            e.title as exam_title, e.subject_id as exam_subject_id
     FROM exam_sessions es
     JOIN exams e ON es.exam_id = e.id
     WHERE es.candidate_id = ? AND es.status = 'submitted'
     ORDER BY es.submitted_at DESC`,
    [candidateId]
  );

  if (sessions.length === 0) {
    return { hasData: false, subjects: [], weakestTopics: [], strongestTopics: [], recentSessions: [], averagePercentage: null, totalExams: 0 };
  }

  const subjectStats = {}; // subject_id -> { name, correct, total }
  const topicStats = {};   // "subject::tag" -> { subject, tag, correct, total }

  for (const session of sessions) {
    const answers = safeParseObject(session.answers);
    const [rows] = await db.execute(
      `SELECT q.id, q.correct_answers, q.options, q.tags, q.subject_id, s.name as subject_name
       FROM exam_questions eq
       JOIN questions q ON eq.question_id = q.id
       LEFT JOIN subjects s ON q.subject_id = s.id
       WHERE eq.exam_id = ?`,
      [session.exam_id]
    );

    for (const q of rows) {
      const candidateAnswer = extractAnswer(answers[q.id]);
      if (candidateAnswer === null || candidateAnswer.trim() === '') continue; // unanswered — skip, not a "mistake"

      const correctAnswers = safeParseArray(q.correct_answers);
      const options = safeParseArray(q.options);
      const nc = normalise(candidateAnswer);
      let isCorrect = correctAnswers.some(ca => normalise(ca) === nc);
      if (!isCorrect) {
        const li = ['a','b','c','d','e'].indexOf(nc);
        if (li !== -1 && options[li] !== undefined)
          isCorrect = correctAnswers.some(ca => normalise(ca) === normalise(options[li]));
      }

      const subjName = q.subject_name || 'Unknown';
      subjectStats[subjName] = subjectStats[subjName] || { name: subjName, correct: 0, total: 0 };
      subjectStats[subjName].total++;
      if (isCorrect) subjectStats[subjName].correct++;

      const tags = safeParseArray(q.tags);
      for (const tag of tags) {
        const key = `${subjName}::${tag}`;
        topicStats[key] = topicStats[key] || { subject: subjName, tag, correct: 0, total: 0 };
        topicStats[key].total++;
        if (isCorrect) topicStats[key].correct++;
      }
    }
  }

  const subjects = Object.values(subjectStats)
    .map(s => ({ ...s, accuracy: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy);

  // Only surface topics with at least 2 attempts — one lucky/unlucky guess shouldn't label a topic "weak"
  const topicsWithEnoughData = Object.values(topicStats)
    .filter(t => t.total >= 2)
    .map(t => ({ ...t, accuracy: Math.round((t.correct / t.total) * 100) }));

  const weakestTopics = [...topicsWithEnoughData].sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
  const strongestTopics = [...topicsWithEnoughData].sort((a, b) => b.accuracy - a.accuracy).slice(0, 5);

  const averagePercentage = sessions.reduce((sum, s) => sum + (parseFloat(s.percentage) || 0), 0) / sessions.length;

  return {
    hasData: true,
    subjects,
    weakestTopics,
    strongestTopics,
    recentSessions: sessions.slice(0, 5).map(s => ({
      exam_title: s.exam_title,
      percentage: s.percentage,
      submitted_at: s.submitted_at,
    })),
    averagePercentage: Math.round(averagePercentage),
    totalExams: sessions.length,
  };
}

module.exports = { buildCandidateInsights };
