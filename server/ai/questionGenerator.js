const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = 'gemini-3.1-flash-lite';
// Photo scanning (dense multi-column question papers) is the hardest reading task
// in this app — worth spending more of the free-tier budget on accuracy here than
// on the lighter text-only tasks (chat, question generation, essay grading), which
// stay on the lite model above.
const VISION_MODEL = 'gemini-3.5-flash';

function extractJSON(text) {
  const clean = text.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// Gemini's free-tier quota error comes back as a wall of nested JSON — that's
// what was showing up verbatim in the admin's "Pages Needing Attention" list
// instead of something readable. This recognizes that specific error shape
// (RESOURCE_EXHAUSTED / HTTP 429) and turns it into one clear sentence, and
// pulls out the retryDelay Gemini itself suggests, if present, so the admin
// knows roughly how long to wait before hitting Retry Page again.
function parseGeminiError(err) {
  const raw = err?.message || String(err);
  const isQuotaExceeded = raw.includes('RESOURCE_EXHAUSTED') || raw.includes('"code":429') || raw.includes('status: 429');
  if (!isQuotaExceeded) return { isQuotaExceeded: false, message: raw };

  let retryDelaySeconds = null;
  const delayMatch = raw.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (delayMatch) retryDelaySeconds = parseInt(delayMatch[1], 10);

  const message = retryDelaySeconds
    ? `Gemini API free-tier daily quota exceeded. Try again in about ${retryDelaySeconds} seconds, or upgrade to a paid Gemini API plan for higher limits.`
    : `Gemini API free-tier daily quota exceeded. Try again later, or upgrade to a paid Gemini API plan for higher limits.`;

  return { isQuotaExceeded: true, retryDelaySeconds, message };
}

/**
 * Analyze proctoring event with Gemini AI
 */
async function analyzeProctoringEvent(eventData) {
  const {
    event_type,
    candidate_name,
    face_confidence,
    gaze_data,
    audio_level,
    tab_switches,
    face_count,
    elapsed_minutes,
    previous_violations,
  } = eventData;

  const prompt = `You are an AI exam proctor analyzing a suspicious event during a CBT exam.

Candidate: ${candidate_name}
Event Type: ${event_type}
Time into exam: ${elapsed_minutes} minutes
Face detection confidence: ${face_confidence || 'N/A'}%
Faces detected in frame: ${face_count || 1}
Gaze off-screen: ${gaze_data?.off_screen || false}
Audio level spike: ${audio_level || 'normal'}
Tab switch attempts: ${tab_switches || 0}
Previous violations this session: ${previous_violations || 0}

Analyze this event and respond in JSON only (no markdown):
{
  "severity": "info|warning|critical",
  "is_violation": true|false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "recommended_action": "monitor|warn|flag|terminate",
  "details": "detailed analysis"
}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return extractJSON(response.text);
  } catch (err) {
    console.error('AI proctor analysis error:', err);
    return {
      severity: 'warning',
      is_violation: true,
      confidence: 0.5,
      reason: 'Automated detection triggered (AI analysis unavailable)',
      recommended_action: 'monitor',
      details: event_type,
    };
  }
}

/**
 * Generate questions using Gemini AI
 */
async function generateQuestionsWithAI({ subject, topic, difficulty, count, exam_type }) {
  const prompt = `Generate ${count} high-quality ${difficulty} difficulty exam questions for:
Subject: ${subject}
Topic: ${topic}
Exam type: ${exam_type || 'General'}

Requirements:
- Nigerian curriculum standards (WAEC/JAMB/NECO style)
- Each MCQ must have exactly 4 options (A, B, C, D)
- One correct answer per question
- Include brief explanation
- Appropriate for West African secondary school level
- For any mathematical content — fractions, exponents, roots, angles, equations — write it as LaTeX wrapped in single dollar signs, e.g. $x^2 + 3x - 4 = 0$, $\\frac{1}{2}$, $30^\\circ$. This gets rendered with a real math typesetting engine.

Respond in JSON only (no markdown, no backticks):
{
  "questions": [
    {
      "question_text": "...",
      "question_type": "mcq",
      "options": ["option A text", "option B text", "option C text", "option D text"],
      "correct_answers": ["option A text"],
      "explanation": "...",
      "difficulty": "${difficulty}",
      "marks": 1,
      "tags": ["tag1", "tag2"]
    }
  ]
}`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const data = extractJSON(response.text);
  // Preserve $...$ LaTeX markup as-is — the frontend renders it with KaTeX
  // now (see MathText.jsx) rather than flattening it to a Unicode
  // approximation, which lost real math structure (fractions, matrices).
  return data.questions;
}

/**
 * AI-assisted essay grading
 */
async function gradeEssayWithAI({ question_text, model_answer, candidate_answer, max_marks }) {
  const prompt = `You are an expert examiner grading an essay response.

Question: ${question_text}

Model Answer / Marking Guide:
${model_answer}

Candidate's Answer:
${candidate_answer}

Maximum marks: ${max_marks}

Grade this response fairly and respond in JSON only:
{
  "score": number,
  "percentage": number,
  "grade": "A|B|C|D|E|F",
  "feedback": "constructive feedback for candidate",
  "strengths": ["point 1", "point 2"],
  "weaknesses": ["point 1", "point 2"],
  "marking_breakdown": "how marks were allocated"
}`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  return extractJSON(response.text);
}

/**
 * Analyze behavioral pattern across full session
 */
async function analyzeSessionBehavior(sessionData) {
  const { events, duration_minutes, answers_count, total_questions } = sessionData;

  const prompt = `Analyze the exam session behavior for potential academic dishonesty.

Session duration: ${duration_minutes} minutes
Questions answered: ${answers_count} of ${total_questions}
Total events logged: ${events.length}

Events summary:
${events.slice(-20).map(e => `- ${e.event_type} at ${e.created_at} (${e.severity})`).join('\n')}

Provide a behavioral analysis in JSON only:
{
  "overall_risk": "low|medium|high|critical",
  "integrity_score": 0-100,
  "patterns_detected": ["pattern 1", "pattern 2"],
  "summary": "brief overall assessment",
  "recommendation": "pass|review|investigate|disqualify"
}`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return extractJSON(response.text);
  } catch (err) {
    return {
      overall_risk: 'medium',
      integrity_score: 70,
      patterns_detected: [],
      summary: 'Analysis unavailable',
      recommendation: 'review',
    };
  }
}

/**
 * Extract exam questions from a photographed/scanned question paper using Gemini vision
 */
async function extractQuestionsFromImage({ imageBase64, mediaType }) {
  const prompt = `This image is one page from a JAMB/WAEC/NECO/NABTEB past-question compilation booklet. Booklets like this are usually structured in sections across MULTIPLE pages:
- An objective (multiple-choice) question section, numbered from 1 upward (often 1–50)
- A theory/essay question section, usually numbered separately (1, 2, 3...)
- An answers/marking-scheme section, which may repeat the SAME numbers (1–50, or 1, 2, 3...) to give the correct answer and explanation for each earlier question — this is NOT a new set of questions, it answers the ones from an earlier page

Because you are only looking at ONE page in isolation, first decide what this page actually is, then extract accordingly. Respond in JSON only (no markdown, no backticks):

{
  "page_type": "objective_questions | theory_questions | answers_or_solutions | mixed | other",
  "questions": [
    {
      "number": 1,
      "question_type": "mcq | essay",
      "question_text": "...",
      "options": ["option A text", "option B text", "option C text", "option D text"],
      "correct_answer_letter": "A|B|C|D|E|null",
      "explanation": "worked explanation printed alongside THIS question on THIS page, or null",
      "has_diagram": true or false — true if this question includes a figure, graph, table, or diagram the student needs to see to answer it,
      "diagram_box": {"x_min": 0, "y_min": 0, "x_max": 0, "y_max": 0} or null — ONLY when has_diagram is true: a bounding box drawn tightly around just that figure/graph/table (not the surrounding question text), given as percentages of the full image's width and height (0 = left/top edge, 100 = right/bottom edge). Include a little padding around the figure so nothing gets cut off. If two questions share the same diagram (e.g. "use the table for questions 5 to 7"), give each of them the same box.
      "subject_hint": "best guess at subject name, or null",
      "confidence": "high|medium|low"
    }
  ],
  "answers": [
    {
      "number": 1,
      "correct_answer_letter": "A|B|C|D|E|null — for an objective answer key entry",
      "solution_text": "the worked solution / explanation text for that numbered item, exactly as printed"
    }
  ],
  "notes": "anything you could not read clearly, or an empty string"
}

Rules:
- If this page shows actual question text with options (or an essay prompt) that a student would answer, put those in "questions", using the question's own printed number as "number". Set question_type to "mcq" if it has lettered options, "essay" if it's an open-ended prompt with no options.
- If this page is an answer key, marking scheme, or "explanations" section — showing only a number plus the correct answer and/or worked solution, with NO original question text — put those entries in "answers" instead, using the SAME number the paper printed. Leave "questions" empty for this page.
- A page can contain both if it genuinely shows a question immediately followed by its own answer — in that case put it in "questions" with explanation/correct_answer_letter filled in directly, and leave "answers" empty for those items.
- Some options are marked as correct directly on the page itself — circled, boxed, underlined, or otherwise highlighted. When you see this, that IS the correct_answer_letter — read it directly, don't leave it null.
- Set "has_diagram" to true for any question whose meaning depends on a figure, chart, graph, table, or drawing printed on the page — not just questions that literally contain a shape, but also ones that reference "the diagram below", "the table above", "the graph shown", etc. A question sharing a diagram/table with neighbouring questions (e.g. "use the following table for questions 5 to 7") should have has_diagram true for all of them.
- When has_diagram is true, look carefully at where that figure actually sits on the page and estimate its bounding box as accurately as you can — tight enough to exclude unrelated neighbouring questions, generous enough not to clip the figure itself. Getting this roughly right is far more useful than leaving it null.
- Many exam-paper photos use TWO OR THREE COLUMNS of numbered questions side by side. Read the ENTIRE left-most column first, top to bottom, before moving to the next column to its right. Do not skip the first one or two items near the top of a column — they are easy to miss and just as important as the rest. Before finishing, count the questions you found and check the numbers form a continuous, unbroken sequence (1, 2, 3, 4...) with no gaps — if a number is missing, go back and look for it before submitting your answer.
- Never invent a number — use exactly what's printed on the page. If a page has no visible numbering at all, use your best sequential guess but set confidence to "low".
- Never guess a correct answer or invent an explanation that isn't actually shown on the page.
- For any mathematical content — fractions, exponents, roots, angles, algebraic expressions, equations, Greek letters, inequalities, matrices — write it as LaTeX wrapped in single dollar signs, e.g. $x^2 + 3x - 4 = 0$, $\\frac{1}{2}$, $30^\\circ$, $\\sqrt{25}$. This gets rendered with a real math typesetting engine, so correct LaTeX syntax matters more than it would in plain text. Leave ordinary non-mathematical text outside the dollar signs.`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    });
  } catch (visionErr) {
    const geminiErr = parseGeminiError(visionErr);
    if (geminiErr.isQuotaExceeded) {
      // Both models share the same account-level free-tier quota — falling
      // back to the lite model here would just burn a second guaranteed-
      // to-fail request against an already-exhausted quota (this is exactly
      // what was happening: the raw RESOURCE_EXHAUSTED JSON showing up
      // verbatim in the admin's "Pages Needing Attention" list was actually
      // the *second* failure, from the fallback model, after the first one
      // already failed for the same reason). Fail fast with one clean,
      // actionable message instead.
      const cleanErr = new Error(geminiErr.message);
      cleanErr.isQuotaExceeded = true;
      cleanErr.retryDelaySeconds = geminiErr.retryDelaySeconds;
      throw cleanErr;
    }
    // Rate-limited or the model name changed again (Google retires these fast) —
    // fall back to the lite model rather than failing the whole page read.
    console.error(`Vision model (${VISION_MODEL}) failed, falling back to ${MODEL}:`, visionErr.message);
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mediaType, data: imageBase64 } },
              { text: prompt },
            ],
          },
        ],
      });
    } catch (fallbackErr) {
      const fallbackGeminiErr = parseGeminiError(fallbackErr);
      if (fallbackGeminiErr.isQuotaExceeded) {
        const cleanErr = new Error(fallbackGeminiErr.message);
        cleanErr.isQuotaExceeded = true;
        cleanErr.retryDelaySeconds = fallbackGeminiErr.retryDelaySeconds;
        throw cleanErr;
      }
      throw fallbackErr;
    }
  }

  const parsed = extractJSON(response.text);
  // Preserve $...$ LaTeX markup as-is — MathText.jsx renders it with KaTeX on
  // the frontend now, so raw math notation from the model is exactly what we
  // want stored, not a flattened Unicode approximation.
  return parsed;
}

/**
 * AI Study Assistant chat for students
 */
async function chatWithStudyAssistant({ history = [], message }) {
  const systemPrompt = `You are an expert AI study assistant for Nigerian secondary school and tertiary institution students.
You help students understand subjects, explain exam concepts, provide study tips, and coach for WAEC, JAMB, NECO, and NABTEB exams.
Be encouraging, clear, and use examples relevant to Nigerian education. Keep responses concise and helpful.
When explaining difficult concepts, break them down into simple steps.`;

  const contents = [
    ...history.slice(-8).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: systemPrompt },
  });

  return response.text;
}

/**
 * PASS 5 — focused re-verification of a single low-confidence question.
 *
 * Only called for staged questions that scored below 75 in confidenceScoring.js.
 * Re-sends the SAME source image, but this time narrows the model's attention
 * to one specific already-extracted question instead of asking it to read the
 * whole page again — a smaller, more constrained task the model tends to be
 * more accurate on than a full-page first pass.
 *
 * Per section 29 (no hallucination): the model is explicitly told to leave a
 * field unchanged rather than invent something it isn't confident about, and
 * to say so via "unreadable" rather than silently guess.
 */
async function reverifyLowConfidenceQuestion({ imageBase64, mediaType, draftQuestion }) {
  const prompt = `You are re-checking ONE specific question that was already extracted from this exam paper image, because the first extraction pass was not confident about it.

Here is the draft extraction to verify:
${JSON.stringify({
    number: draftQuestion.question_number,
    question_text: draftQuestion.question_text,
    options: draftQuestion.options || [],
    correct_answer_letter: draftQuestion.correct_answer_letter || null,
  }, null, 2)}

Look specifically at question number ${draftQuestion.question_number ?? '(unnumbered — locate it near where a number this close would appear)'} on the page.

Respond in JSON only (no markdown, no backticks):
{
  "found_on_page": true|false,
  "question_text": "the corrected/confirmed text, or the original if it was already correct",
  "options": ["...", "...", "...", "..."],
  "correct_answer_letter": "A|B|C|D|E|null",
  "unreadable_fields": ["list any of: question_text, options, correct_answer_letter — that you genuinely cannot read clearly, rather than guessing"],
  "changed_from_draft": true|false,
  "verifier_confidence": "high|medium|low"
}

Rules:
- If the draft was already accurate, return it unchanged with changed_from_draft: false.
- Only change a field if you can clearly read something different from the draft on the actual page — never invent text that isn't visibly printed.
- If you genuinely cannot locate or read this question on the page, set found_on_page to false and leave the other fields as the original draft values.
- Do not guess a correct answer that isn't marked, circled, or otherwise indicated on the page — list it in unreadable_fields instead.
- Write any mathematical content as LaTeX wrapped in single dollar signs, e.g. $x^2$, $30^\\circ$ — this gets rendered with a real math typesetting engine.`;

  try {
    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    });
    const verdict = extractJSON(response.text);
    // Preserve $...$ LaTeX markup as-is — see the note in extractQuestionsFromImage above.
    return verdict;
  } catch (err) {
    console.error('Pass 5 re-verification failed:', err.message);
    // Fail safe: report nothing changed rather than crash the batch —
    // the question stays at its original (low) confidence and needs_review.
    return {
      found_on_page: null,
      question_text: draftQuestion.question_text,
      options: draftQuestion.options || [],
      correct_answer_letter: draftQuestion.correct_answer_letter || null,
      unreadable_fields: [],
      changed_from_draft: false,
      verifier_confidence: 'low',
      verification_error: err.message,
    };
  }
}

/**
 * Drafts exam-prep learning content for one syllabus topic — the "Read Topic"
 * material from the exam-preparation spec. Always returns a DRAFT; the
 * calling route is responsible for keeping it unpublished until an admin
 * reviews it (section 20: never show AI content as official without review).
 */
async function generateTopicContent({ examBody, examination, subject, topic }) {
  const prompt = `You are drafting exam-preparation study material for a Nigerian secondary school student, for the following exact topic:

Examination Body: ${examBody}
Examination: ${examination}
Subject: ${subject}
Topic: ${topic}

This content will be reviewed and edited by a qualified teacher before students see it — draft it as a strong starting point, not final copy. Focus specifically on what's needed for ${examBody} ${examination} exam success on this topic, not a general textbook chapter.

Respond in JSON only (no markdown, no backticks):
{
  "learning_objectives": "3-5 bullet points (as a single string with line breaks) of what the student should be able to do after this topic",
  "key_concepts": "the core ideas explained clearly, in plain language a student can follow",
  "formulas": "any formulas relevant to this topic, clearly labeled — write 'None applicable' if the topic has none",
  "definitions": "important terms and their definitions",
  "worked_examples": "1-3 worked examples showing step-by-step solutions, exam-style",
  "exam_tips": "specific patterns ${examBody} tends to test on this topic, and what students commonly get wrong",
  "common_mistakes": "the specific errors students typically make on this topic and how to avoid them"
}

Keep each field factually careful — do not invent formulas, dates, or claims you're not confident are accurate. If genuinely unsure about something specific to ${examBody}'s exact syllabus emphasis, write general best-practice guidance instead of guessing at exam-body-specific details.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  return extractJSON(response.text);
}

/**
 * Attempts to actually SOLVE an objective question using the model's own
 * reasoning — distinct from reverifyLowConfidenceQuestion, which only
 * re-reads the page and deliberately refuses to guess an unmarked answer.
 * This is for questions where no answer key was found anywhere in the
 * source pages, so there's nothing to "re-read" — the only way to get an
 * answer is genuine computation/reasoning from the problem itself.
 *
 * Always labeled distinctly in review_notes by the caller as AI-derived,
 * never auto-published as verified — a human confirms computational
 * correctness before it goes live, same principle as section 20's content
 * labeling for the exam-prep learning system.
 */
async function solveObjectiveQuestion({ question_text, options, subject }) {
  if (!Array.isArray(options) || options.length < 2) {
    return { solvable: false, reason: 'Not enough options to solve against' };
  }
  const prompt = `Solve this ${subject || ''} exam question step by step, then pick the correct option.

Question: ${question_text}

Options:
${options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}

Respond in JSON only (no markdown, no backticks):
{
  "solvable": true|false,
  "correct_answer_letter": "A|B|C|D|E|null",
  "solution_steps": "concise step-by-step working showing how you got the answer",
  "confidence": "high|medium|low"
}

Rules:
- Only set solvable: true if you can actually work through the problem and confidently arrive at one of the given options.
- If the question is ambiguous, relies on a diagram/table you can't see from text alone, or none of the options match your computed answer, set solvable: false and explain why in solution_steps.
- Show real working, not just the answer — this will be reviewed by a teacher before students see it.
- Write any mathematical content in solution_steps as LaTeX wrapped in single dollar signs, e.g. $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ — this gets rendered with a real math typesetting engine.`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    const result = extractJSON(response.text);
    // Preserve $...$ LaTeX in solution_steps as-is — rendered with KaTeX.
    return result;
  } catch (err) {
    console.error('solveObjectiveQuestion failed:', err.message);
    return { solvable: false, reason: err.message };
  }
}

/**
 * Generates a step-by-step explanation for a question whose correct answer
 * is ALREADY known — distinct from solveObjectiveQuestion, which is used
 * during import to work out an answer that isn't recorded anywhere yet.
 * This is for the common case of a live, published question that has a
 * correct_answers value but an empty explanation field (e.g. older imports
 * done before explanations were required). Since the answer is already
 * confirmed, this only needs to narrate the reasoning to it, not verify it.
 *
 * question_type-aware: MCQ/objective questions get an explanation of how to
 * reach the recorded correct answer. Essay/theory questions have no single
 * "correct answer" to check against, so they instead get a model-answer-
 * style explanation of how to approach and structure a strong response —
 * previously these were entirely unsupported (the caller required a
 * non-empty correct_answers array), so essay/theory questions could never
 * get an auto-generated explanation at all, regardless of retries.
 *
 * A transient failure from the AI call is retried a couple of times with a
 * short backoff before giving up — a single dropped/rate-limited call
 * shouldn't permanently deny a question its explanation.
 */
async function explainAnswer({ question_text, options, correct_answers, subject, question_type }) {
  const correctList = Array.isArray(correct_answers) ? correct_answers : [];
  const isEssayLike = question_type === 'essay' || (!options?.length && correctList.length === 0);

  const prompt = isEssayLike
    ? `You are an experienced ${subject || ''} exam tutor. A student just answered this essay/theory question and wants guidance on how a strong answer is built.

Question: ${question_text}

There is no single fixed correct answer to check against — instead, explain the reasoning and structure a strong answer would follow: the key points/steps a student should cover, and why each matters. Suitable for a West African secondary school student preparing for WAEC/JAMB/NECO. Keep it focused: a few sentences to a short paragraph, not an essay.

Write any mathematical content as LaTeX wrapped in single dollar signs, e.g. $x^2 + 3x - 4 = 0$, $\\frac{1}{2}$, $30^\\circ$ — this gets rendered with a real math typesetting engine, so don't convert it to Unicode or plain text yourself.

Respond in JSON only (no markdown, no backticks):
{
  "explanation": "..."
}`
    : `You are an experienced ${subject || ''} exam tutor. A student just answered this question and wants to understand how the correct answer is reached.

Question: ${question_text}

Options:
${(options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}

Confirmed correct answer: ${correctList.join(', ') || '(not specified)'}

Write a clear, concise, step-by-step explanation of how a student arrives at the correct answer — walk through the method/reasoning, not just a restatement of the answer. Suitable for a West African secondary school student preparing for WAEC/JAMB/NECO. Keep it focused: a few sentences to a short paragraph, not an essay.

Write any mathematical content as LaTeX wrapped in single dollar signs, e.g. $x^2 + 3x - 4 = 0$, $\\frac{1}{2}$, $30^\\circ$ — this gets rendered with a real math typesetting engine, so don't convert it to Unicode or plain text yourself.

Respond in JSON only (no markdown, no backticks):
{
  "explanation": "..."
}`;

  // Explanation generation shares the exact same Gemini account/quota as
  // everything else (question extraction, essay grading, chat) — so once
  // that daily free-tier quota is exhausted anywhere, EVERY explanation
  // call fails too, regardless of how simple the question is. Previously
  // this retried blindly 3 times against a guaranteed-exhausted quota, then
  // swallowed the failure and returned '' — which the caller (routes/
  // questions.js) turned into a fake-successful 200 response with an empty
  // explanation, and the UI showed "No explanation available for this
  // question yet" as if that question specifically couldn't be explained.
  // That's what looked like "skipping explanations on many/easy questions"
  // — it was never about the question, it was quota exhaustion being
  // silently absorbed. Now: detect it immediately, skip the pointless
  // retry loop, and throw a real error the route can surface properly.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await ai.models.generateContent({ model: MODEL, contents: prompt });
      const result = extractJSON(response.text);
      if (result.explanation) return result.explanation;
      lastErr = new Error('AI returned no explanation field');
    } catch (err) {
      const geminiErr = parseGeminiError(err);
      if (geminiErr.isQuotaExceeded) {
        const cleanErr = new Error(geminiErr.message);
        cleanErr.isQuotaExceeded = true;
        cleanErr.retryDelaySeconds = geminiErr.retryDelaySeconds;
        throw cleanErr; // don't burn remaining attempts against the same exhausted quota
      }
      lastErr = err;
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 800 * attempt));
  }
  console.error('explainAnswer failed after retries:', lastErr?.message);
  throw lastErr || new Error('Failed to generate explanation');
}

/**
 * Reconstructs a cropped diagram photo as clean, native SVG markup —
 * Milestone E2. This is the highest-risk piece of the "no screenshots"
 * redesign: an AI-generated geometry diagram can look plausible while being
 * subtly wrong (angle proportions off, a mislabeled point), which is worse
 * than a slightly rough photo. So this function is ALWAYS opt-in per
 * question, admin-triggered, and the caller must show the original photo
 * side-by-side with the result for human verification before it's ever
 * accepted — see the reconstruct-diagram route in importBatches.js.
 *
 * Returns { svg, elements_description, confidence } rather than silently
 * committing to a result — confidence gives the admin an extra signal on
 * top of their own visual check, and elements_description explains what the
 * model believes it's looking at, which helps spot a misread quickly (e.g.
 * "isosceles triangle" when the photo is actually a right triangle).
 */
async function reconstructDiagramSVG({ imageBase64, mediaType, questionText }) {
  const prompt = `This image is a cropped diagram from a mathematics/science exam question. The question it belongs to is:

"${questionText || '(not provided)'}"

Recreate this diagram as a clean, professional SVG — the kind you'd see in a modern digital textbook, not a scan of a printed page.

Rules:
- Preserve every mathematically necessary element exactly: shapes, points, labels, given values (angles, lengths, etc.), and the relationships between them (which lines are parallel, which angle is marked, which point is the centre, etc.).
- Do NOT preserve: paper texture, scan shadows, crop edges, handwritten marks, circled answers, or anything not part of the diagram itself.
- Use a clean white/transparent background, consistent stroke width (around 2px), a readable sans-serif font for labels, and balanced spacing.
- viewBox should be a clean 0 0 W H with reasonable dimensions (e.g. 0 0 400 300) — do not hardcode pixel-perfect coordinates from the original photo.
- If you cannot confidently determine an element's exact position/value (a number is unreadable, a label is ambiguous), do NOT guess — note it in elements_description and lower your confidence rather than inventing a plausible-looking placement.

Respond in JSON only (no markdown, no backticks):
{
  "svg": "the complete <svg>...</svg> markup as a single string",
  "elements_description": "a plain-language list of what you identified in the diagram (shapes, points, labels, given values) — this is shown to a teacher for verification, so be specific",
  "confidence": "high|medium|low",
  "uncertain_elements": ["any specific elements you weren't fully confident reading, if any"]
}`;

  try {
    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    });
    const result = extractJSON(response.text);
    // Basic sanity check — don't hand back something that isn't even SVG-shaped.
    if (!result.svg || !result.svg.trim().startsWith('<svg')) {
      return { svg: null, elements_description: result.elements_description || null, confidence: 'low', error: 'Model did not return valid SVG markup' };
    }
    return result;
  } catch (err) {
    console.error('reconstructDiagramSVG failed:', err.message);
    return { svg: null, elements_description: null, confidence: 'low', error: err.message };
  }
}

/**
 * Runs the source-photo artifact checklist from spec section 11 — the
 * checks that genuinely need a fresh look at the image, not just a re-read
 * of the extracted text: crop edges, neighboring question bleed, handwritten
 * marks, watermarks/page furniture. Opt-in per question (admin-triggered
 * from the review screen), not automatic for every import — same cost
 * discipline as diagram reconstruction and Pass 5 re-verification.
 *
 * Deliberately does NOT re-judge extraction correctness (that's what
 * confidence scoring and Pass 5 already do) — this is specifically about
 * whether the SOURCE PHOTO itself is clean enough that nothing needs manual
 * cleanup or a re-crop before this diagram is used or reconstructed as SVG.
 */
async function qualityCheckDiagram({ imageBase64, mediaType, questionText }) {
  const prompt = `You are doing a quality-control pass on a cropped exam-question photo before it's used in a digital learning app. The question this crop belongs to is:

"${questionText || '(not provided)'}"

Check the image for each of these specific artifacts and report pass/fail/uncertain for each:

Respond in JSON only (no markdown, no backticks):
{
  "checks": [
    { "id": "crop_edges", "label": "No visible crop boundaries or uneven edges", "status": "pass|fail|uncertain", "note": "brief reason if fail/uncertain" },
    { "id": "neighboring_text", "label": "No text/content from a neighboring question bleeding in", "status": "pass|fail|uncertain", "note": "" },
    { "id": "handwriting", "label": "No handwritten marks, circled answers, or candidate annotations", "status": "pass|fail|uncertain", "note": "" },
    { "id": "artifacts", "label": "No scanner shadows, watermarks, page numbers, or paper texture noise", "status": "pass|fail|uncertain", "note": "" },
    { "id": "diagram_match", "label": "The diagram's elements actually match what the question text describes", "status": "pass|fail|uncertain|not_applicable", "note": "" }
  ],
  "overall": "pass|needs_cleanup|fail"
}

Set "overall" to "fail" only if something would actually mislead or confuse a student (e.g. wrong diagram, illegible content). Use "needs_cleanup" for cosmetic issues (a crop edge, minor shadow) that don't affect correctness. Use "not_applicable" for diagram_match if this image isn't actually a diagram.`;

  try {
    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    });
    return extractJSON(response.text);
  } catch (err) {
    console.error('qualityCheckDiagram failed:', err.message);
    return { checks: [], overall: 'fail', error: err.message };
  }
}

module.exports = {
  analyzeProctoringEvent,
  generateQuestionsWithAI,
  gradeEssayWithAI,
  analyzeSessionBehavior,
  extractQuestionsFromImage,
  reverifyLowConfidenceQuestion,
  generateTopicContent,
  solveObjectiveQuestion,
  explainAnswer,
  chatWithStudyAssistant,
  reconstructDiagramSVG,
  qualityCheckDiagram,
  parseGeminiError,
};
