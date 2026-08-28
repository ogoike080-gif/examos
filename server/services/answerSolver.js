const fs = require('fs');
const path = require('path');
const { solveObjectiveQuestion, parseGeminiError } = require('../ai/questionGenerator');

// media_url is a public path like /uploads/diagrams/xxx.jpg, served directly
// by express.static(uploads) in index.js — that maps 1:1 onto this same
// server's uploads/ directory on disk, so the file for a given question's
// diagram is always right here, no separate storage lookup needed.
// Missing/unreadable files fail soft (undefined) rather than throwing — a
// broken diagram link shouldn't block a question that's otherwise solvable
// from its text alone.
function readDiagramImage(mediaUrl) {
  if (!mediaUrl || !mediaUrl.startsWith('/uploads/')) return undefined;
  try {
    const filePath = path.join(__dirname, '..', mediaUrl);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { imageBase64: buffer.toString('base64'), mediaType };
  } catch (err) {
    console.error(`readDiagramImage: couldn't read diagram at ${mediaUrl}:`, err.message);
    return undefined;
  }
}

/**
 * Attempts to AI-solve one question's missing correct_answers and persists
 * the result (and, when the model provides one, its worked solution as the
 * explanation too — one AI call covers both instead of two). Shared by:
 *   - routes/questions.js generate-explanation (solves on-the-spot the
 *     instant a student/reviewer hits a question with no recorded answer,
 *     instead of just 400ing)
 *   - routes/questions.js backfill-correct-answers (admin-triggered batch)
 *   - services/autoAnswerSolver.js (fully automatic background batch, no
 *     admin action needed at all)
 *
 * Returns one of:
 *   { status: 'fixed', correct_answers: [...], explanation: string|null }
 *   { status: 'unsolvable' }               — genuinely ambiguous/unreadable
 *   { status: 'quota_exceeded', retryDelaySeconds }
 *   { status: 'error', message }
 */
async function solveAndSaveMissingAnswer(db, question) {
  let options;
  try { options = Array.isArray(question.options) ? question.options : JSON.parse(question.options || '[]'); }
  catch { options = []; }
  if (options.length < 2) return { status: 'unsolvable' };

  try {
    const diagram = readDiagramImage(question.media_url);
    const result = await solveObjectiveQuestion({
      question_text: question.question_text,
      options,
      subject: question.subject_name,
      imageBase64: diagram?.imageBase64,
      mediaType: diagram?.mediaType,
    });

    const letterIndex = result?.correct_answer_letter
      ? result.correct_answer_letter.toUpperCase().charCodeAt(0) - 65
      : -1;

    if (result?.solvable && letterIndex >= 0 && letterIndex < options.length) {
      const correctAnswerText = options[letterIndex];
      const correct_answers = [correctAnswerText];
      const explanation = result.solution_steps || null;
      if (explanation) {
        await db.execute('UPDATE questions SET correct_answers=?, explanation=? WHERE id=?',
          [JSON.stringify(correct_answers), explanation, question.id]);
      } else {
        await db.execute('UPDATE questions SET correct_answers=? WHERE id=?',
          [JSON.stringify(correct_answers), question.id]);
      }
      return { status: 'fixed', correct_answers, explanation };
    }
    // Genuinely unsolvable (ambiguous, needs a diagram not in the text, none
    // of the options matched the model's own working) — leave it for a
    // human to fix manually rather than guessing.
    return { status: 'unsolvable' };
  } catch (err) {
    const geminiErr = parseGeminiError(err);
    if (geminiErr.isQuotaExceeded) {
      return { status: 'quota_exceeded', retryDelaySeconds: geminiErr.retryDelaySeconds || null };
    }
    console.error(`solveAndSaveMissingAnswer: failed on question ${question.id}:`, err.message);
    return { status: 'error', message: err.message };
  }
}

module.exports = { solveAndSaveMissingAnswer, readDiagramImage };
