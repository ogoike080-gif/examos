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
  try {
    return JSON.parse(clean);
  } catch (err) {
    // The most common failure here isn't a genuinely malformed response — it's
    // the vision/generation prompts (see extractQuestionsFromImage, explainAnswer)
    // deliberately asking the model to write LaTeX like \frac{1}{2} or 30^\circ
    // into JSON string values. For that to be valid JSON the model must double
    // the backslash (\\frac), and it frequently gets this only PARTLY right —
    // a single response can mix correctly-escaped macros (\\frac, \\sqrt) with
    // broken ones (\propto) side by side, especially on math-dense exam pages.
    // That mix is exactly why a naive per-backslash regex doesn't work: if you
    // inspect one backslash at a time, the SECOND backslash of an already-
    // correct "\\frac" pair looks just like a lone bad backslash (next char is
    // a letter) and gets "fixed" again, corrupting a correct escape while
    // trying to repair a broken one nearby, which just moves the SyntaxError
    // further into the string instead of resolving it.
    //
    // Matching whole recognized escape TOKENS first avoids that: `\\\\` (an
    // already-correct escaped backslash), `\\["\\/]`, and `\\uXXXX` are each
    // matched and consumed as a single unit and left untouched. Only a
    // backslash that isn't the start of any of those — the real LaTeX-macro
    // case — falls through to the bare `\\` alternative and gets doubled.
    // Deliberately excludes \b \f \n \r \t from the "leave alone" set even
    // though they're technically valid JSON escapes: in this LaTeX-heavy
    // context they're overwhelmingly more likely to be the first letter of a
    // macro (\beta, \frac, \neq, \theta/\times/\tan) than a real control
    // character, and leaving them alone silently corrupts math into invisible
    // control characters instead of throwing — worse than a slightly
    // over-eager repair. Worst case for a rare genuine \n is a literal "\n"
    // surviving as visible text instead of a real line break — a cosmetic
    // downgrade, not corruption.
    const repaired = clean.replace(
      /\\\\|\\["\\/]|\\u[0-9a-fA-F]{4}|\\/g,
      (m) => (m === '\\' ? '\\\\' : m)
    );
    return JSON.parse(repaired);
  }
}

/**
 * Normalizes whatever the @google/genai SDK throws into a consistent, plain
 * shape — { message, isQuotaExceeded, retryDelaySeconds } — so callers never
 * need to know Google's raw error format to handle a rate-limit sanely.
 *
 * The SDK doesn't throw a typed error with clean fields; it throws an Error
 * whose .message is often the ENTIRE upstream HTTP error body serialized as
 * text (sometimes JSON, sometimes JSON embedded after a "got status" prefix).
 * For a 429 that body looks roughly like:
 *   { "error": { "code": 429, "status": "RESOURCE_EXHAUSTED", "message": "...",
 *       "details": [ ..., { "@type": ".../RetryInfo", "retryDelay": "41s" } ] } }
 * This digs the useful bits out of that without assuming it's always present
 * in exactly that shape — free-tier limits, error formats, and model names
 * are all things Google changes without notice.
 */
function parseGeminiError(err) {
  const rawMessage = err?.message || String(err || 'Unknown AI error');

  // The JSON body, if the SDK included one, is usually the last `{...}` block
  // in the message. Pull it out defensively — if this fails for any reason,
  // fall through to the plain-text heuristics below instead of throwing.
  let parsedBody = null;
  const jsonMatch = rawMessage.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { parsedBody = JSON.parse(jsonMatch[0]); } catch { /* not JSON — fine */ }
  }

  const apiError = parsedBody?.error;
  const code = apiError?.code ?? err?.status ?? err?.code;
  const status = apiError?.status ?? err?.status;

  const isQuotaExceeded =
    code === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    /RESOURCE_EXHAUSTED|quota/i.test(rawMessage);

  if (!isQuotaExceeded) {
    // Not a quota error — pass through a short, human-readable version rather
    // than dumping the full raw SDK error (which can be a huge nested JSON
    // blob) into a UI toast or a stored error_message column.
    const shortMessage = (apiError?.message || rawMessage).slice(0, 300);
    return { message: shortMessage, isQuotaExceeded: false, retryDelaySeconds: null };
  }

  // Look for Google's RetryInfo detail block: { "@type": ".../RetryInfo",
  // "retryDelay": "41s" }. Fall back to scanning the raw text for a bare
  // "41s"-style token if the structured details aren't present for some
  // reason (e.g. a different error shape than expected).
  let retryDelaySeconds = null;
  const retryDetail = apiError?.details?.find(d => typeof d['@type'] === 'string' && d['@type'].includes('RetryInfo'));
  const retryDelayStr = retryDetail?.retryDelay || rawMessage.match(/retryDelay["']?\s*[:=]\s*["']?(\d+)s/)?.[1];
  if (retryDelayStr) {
    const n = parseInt(retryDelayStr, 10);
    if (!Number.isNaN(n)) retryDelaySeconds = n;
  }

  // Free-tier Gemini has TWO separate quota dimensions that both throw the
  // same RESOURCE_EXHAUSTED/429 shape: a small per-MINUTE request cap and a
  // much larger per-DAY cap. They reset completely differently (the minute
  // cap clears in well under a minute; the day cap doesn't reset until
  // midnight Pacific), so conflating them produces a message that's actively
  // misleading either way it's wrong — telling someone to wait "a day" for a
  // 30-second cooldown, or "retry in 30 seconds" for something that won't
  // clear for hours. Google's QuotaFailure violation includes a quotaId
  // string containing "PerMinute" or "PerDay" — check that first. If it's
  // genuinely absent or ambiguous, fall back to using retryDelaySeconds
  // itself as the signal: real per-day exhaustion reports a retry delay of
  // minutes-to-hours, never under a minute.
  const quotaFailureDetail = apiError?.details?.find(d => typeof d['@type'] === 'string' && d['@type'].includes('QuotaFailure'));
  const quotaIdText = quotaFailureDetail?.violations?.map(v => `${v.quotaId || ''} ${v.quotaMetric || ''}`).join(' ') || '';
  const isPerMinute = /PerMinute/i.test(quotaIdText) || (!quotaIdText && retryDelaySeconds !== null && retryDelaySeconds < 60);
  const isPerDay = /PerDay/i.test(quotaIdText) || (!quotaIdText && (retryDelaySeconds === null || retryDelaySeconds >= 60));

  let message;
  if (isPerMinute && !isPerDay) {
    message = retryDelaySeconds
      ? `Gemini API rate limit reached (too many requests per minute on the free tier). This clears itself — try again in about ${retryDelaySeconds} seconds.`
      : `Gemini API rate limit reached (too many requests per minute on the free tier). This clears itself within a minute or so — try again shortly.`;
  } else {
    message = retryDelaySeconds
      ? `Gemini API free-tier daily quota exceeded. This won't reset for a while (about ${Math.ceil(retryDelaySeconds / 60)} minutes) — resume later, or upgrade to a paid Gemini API plan for higher limits.`
      : `Gemini API free-tier daily quota exceeded — this typically doesn't reset until later. Resume this batch then, or upgrade to a paid Gemini API plan for higher limits.`;
  }

  return { message, isQuotaExceeded: true, retryDelaySeconds, isPerMinute: !!(isPerMinute && !isPerDay) };
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
      "diagram_box": {"x_min": 0, "y_min": 0, "x_max": 0, "y_max": 0} or null — ONLY when has_diagram is true: a bounding box around just that figure/graph/table (not the surrounding question text), given as percentages of the full image's width and height (0 = left/top edge, 100 = right/bottom edge). Bias generous, not tight: include every axis label, tick mark, legend, unit label, and table border inside the box, plus a visible margin of empty space on all four sides. A box that includes a bit of surrounding whitespace or nearby text is fine; a box that clips any part of the figure itself is not — when in doubt, make the box bigger. If two questions share the same diagram (e.g. "use the table for questions 5 to 7"), give each of them the same box.
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
- When has_diagram is true, look carefully at where that figure actually sits on the page and estimate its bounding box as accurately as you can — it only needs to be tight enough to exclude unrelated neighbouring questions; err on the side of a bigger box rather than risk cutting off any part of the figure, its axis labels, or its table borders. Getting this roughly right is far more useful than leaving it null.
- Many exam-paper photos use TWO OR THREE COLUMNS of numbered questions side by side. Read the ENTIRE left-most column first, top to bottom, before moving to the next column to its right. Do not skip the first one or two items near the top of a column — they are easy to miss and just as important as the rest. Before finishing, count the questions you found and check the numbers form a continuous, unbroken sequence (1, 2, 3, 4...) with no gaps — if a number is missing, go back and look for it before submitting your answer.
- Never invent a number — use exactly what's printed on the page. If a page has no visible numbering at all, use your best sequential guess but set confidence to "low".
- Never guess a correct answer or invent an explanation that isn't actually shown on the page.
- A multi-part question (parts (a), (b), (c)... or (i), (ii), (iii)... under one shared number and one shared prompt/dataset) is ONE question, not several. Put the entire thing — the shared setup plus every lettered/numbered part — into a single question_text for that one number. Never extract an individual part like "(b)(ii) find the 80th percentile" as if it were its own standalone question with its own number and options — it has no meaning on its own without the shared data/diagram the real question provides, and doing this produces an unanswerable fragment.
- Some questions (common in CRS/IRS/Literature/English) are printed as ONE continuous sentence that each lettered option completes differently — e.g. "At Shechem, God appeared to Abram and told him that A. the land would be given to his descendants. B. he should continue on his journey southwards. C. he should leave his country. D. he should settle there with his descendants." Do NOT dump this whole sentence into question_text with options left as bare letters — split it: question_text is the shared opening ("At Shechem, God appeared to Abram and told him that..."), and each option is that SAME opening completed by its own ending ("the land would be given to his descendants.", "he should continue on his journey southwards.", etc. — the full completed sentence, or just the completing clause, either is fine as long as each option is genuinely different real text, never a bare letter).
- For any mathematical content — fractions, exponents, roots, angles, algebraic expressions, equations, Greek letters, inequalities, matrices — write it as LaTeX wrapped in single dollar signs, e.g. $x^2 + 3x - 4 = 0$, $\\frac{1}{2}$, $30^\\circ$, $\\sqrt{25}$. This gets rendered with a real math typesetting engine, so correct LaTeX syntax matters more than it would in plain text. Leave ordinary non-mathematical text outside the dollar signs.
- For a data table (frequency table, grouped data, etc.) that's part of the question text rather than a separate figure: NEVER use LaTeX table syntax like \\begin{tabular}, \\hline, or \\\\ as row separators — none of that renders here, it will show up as broken literal text. Instead write the table as plain readable text, one row per line, e.g.:
Weekly profit (N): 1-10, 11-20, 21-30, 31-40, 41-50, 51-60
Frequency: 6, 6, 12, 11, 10, 5
  If the table is large/complex or is really a printed figure rather than something you can cleanly re-type, set has_diagram true and give it a diagram_box instead of trying to transcribe it as text.`;

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
      // Both models failed — in practice this almost always means the whole
      // Gemini account (not just one model) has hit its free-tier daily
      // quota, since the two models don't normally fail for the same reason
      // at the same time otherwise. Tag the thrown error so callers (the
      // batch import loop, the single-page retry route in importBatches.js)
      // can detect this specifically and short-circuit remaining pages
      // instead of retrying each one and hitting the same wall.
      const { message, isQuotaExceeded, retryDelaySeconds } = parseGeminiError(fallbackErr);
      throw Object.assign(new Error(message), { isQuotaExceeded, retryDelaySeconds });
    }
  }

  const parsed = extractJSON(response.text);
  // Preserve $...$ LaTeX markup as-is — MathText.jsx renders it with KaTeX on
  // the frontend now, so raw math notation from the model is exactly what we
  // want stored, not a flattened Unicode approximation.
  //
  // Defensive cleanup for one specific failure mode: even with the prompt's
  // explicit instruction against it, the model can still occasionally emit
  // LaTeX table syntax (\begin{tabular}, \hline, \\ row separators) for a
  // data table — none of that is math-mode KaTeX, so it doesn't render, it
  // just shows up as broken literal text to a student. Strip it down to
  // plain readable text as a safety net, rather than trusting every single
  // extraction to follow the prompt correctly.
  const cleanTableSyntax = (text) => {
    if (typeof text !== 'string' || !text.includes('tabular')) return text;
    return text
      .replace(/\\begin\{tabular\}(\{[^}]*\})?/g, '')
      .replace(/\\end\{tabular\}/g, '')
      .replace(/\\hline/g, '')
      .replace(/\\\\/g, '\n')
      .replace(/&/g, ' | ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
  if (Array.isArray(parsed.questions)) {
    parsed.questions.forEach(q => { if (q.question_text) q.question_text = cleanTableSyntax(q.question_text); });
  }
  if (Array.isArray(parsed.answers)) {
    parsed.answers.forEach(a => { if (a.solution_text) a.solution_text = cleanTableSyntax(a.solution_text); });
  }
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
 * Locates and boxes JUST one specific question's diagram on its original
 * source page — used by services/autoDiagramCropper.js to fix a question
 * that's live but missing its diagram image (or whose crop clearly failed),
 * without re-extracting every other question on the page from scratch. This
 * is the single-question sibling of the has_diagram/diagram_box fields
 * extractQuestionsFromImage produces for a whole page at once.
 */
async function locateQuestionDiagram({ imageBase64, mediaType, question_number, question_text }) {
  const prompt = `This is a scanned exam paper page. Find ONE specific question on it and report whether it has an accompanying figure/diagram/graph/table, and if so, exactly where that figure sits on the page.

The question to find:
${question_number != null ? `Question number ${question_number}` : '(unnumbered — use the text below to locate it)'}
Question text: "${question_text}"

Respond in JSON only (no markdown, no backticks):
{
  "found_on_page": true|false,
  "has_diagram": true|false,
  "diagram_box": {"x_min": 0, "y_min": 0, "x_max": 0, "y_max": 0} or null
}

Rules:
- diagram_box is given as percentages of the full image's width and height (0 = left/top edge, 100 = right/bottom edge), a bounding box around just that one figure — not the surrounding question text, and not any other question's figure on the same page.
- Bias generous, not tight: include every axis label, tick mark, legend, unit label, and table border inside the box, plus a visible margin of empty space on all four sides. A box that includes a bit of surrounding whitespace or nearby text is fine; a box that clips any part of the figure itself is not.
- If you can't find this question on the page at all, set found_on_page: false and has_diagram: false.
- If you find the question but it has no figure of its own (a pure text/computation question), set has_diagram: false and diagram_box: null.`;

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
    const geminiErr = parseGeminiError(err);
    if (geminiErr.isQuotaExceeded) throw Object.assign(new Error(geminiErr.message), { isQuotaExceeded: true, retryDelaySeconds: geminiErr.retryDelaySeconds });
    console.error('locateQuestionDiagram failed:', err.message);
    return { found_on_page: null, has_diagram: false, diagram_box: null, error: err.message };
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
// solveObjectiveQuestion optionally accepts a diagram image (imageBase64 +
// mediaType) alongside the question text — many objective questions are
// unsolvable from text alone (a Venn diagram, a graph to read values off,
// a table of figures) because the actual data needed to answer is drawn in
// the image, not written in the question_text column at all. Without an
// image, this behaves exactly as before (text-only, on the lite model);
// passing one switches to the vision model (with the same fallback pattern
// used in extractQuestionsFromImage above) so the model can actually look
// at the figure instead of just being told a diagram exists.
async function solveObjectiveQuestion({ question_text, options, subject, imageBase64, mediaType }) {
  if (!Array.isArray(options) || options.length < 2) {
    return { solvable: false, reason: 'Not enough options to solve against' };
  }
  const hasImage = !!(imageBase64 && mediaType);
  const prompt = `Solve this ${subject || ''} exam question step by step, then pick the correct option.
${hasImage ? '\nA diagram/figure/table for this question is attached as an image — look at it carefully, it likely contains information (numbers, labels, shapes, values) needed to answer the question that isn\'t written in the question text at all.\n' : ''}
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
- If the question is ambiguous, relies on a diagram/table you can't read clearly${hasImage ? ' even from the attached image' : ' from text alone'}, or none of the options match your computed answer, set solvable: false and explain why in solution_steps.
- Show real working, not just the answer — this will be reviewed by a teacher before students see it.
- Write any mathematical content in solution_steps as LaTeX wrapped in single dollar signs, e.g. $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ — this gets rendered with a real math typesetting engine.`;

  const contents = hasImage
    ? [{ role: 'user', parts: [{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: prompt }] }]
    : prompt;

  try {
    let response;
    if (hasImage) {
      try {
        response = await ai.models.generateContent({ model: VISION_MODEL, contents });
      } catch (visionErr) {
        console.error(`solveObjectiveQuestion vision model (${VISION_MODEL}) failed, falling back to ${MODEL}:`, visionErr.message);
        response = await ai.models.generateContent({ model: MODEL, contents });
      }
    } else {
      response = await ai.models.generateContent({ model: MODEL, contents });
    }
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
// Distinct, honest marker stored when Gemini declines to generate an
// explanation at all (a content-safety block, not a transient failure) —
// deliberately NOT blank. An empty string looks identical to "hasn't been
// tried yet" to the caching check in routes/questions.js, which would mean
// re-attempting (and getting re-blocked) on every single page view forever.
// Storing this instead satisfies that cache check, so a genuinely-blocked
// question is asked about exactly once, not endlessly — and gives whoever
// reads it an honest, actionable reason instead of silence.
const EXPLANATION_BLOCKED_MARKER = '⚠️ An explanation could not be generated automatically for this question — it may involve sensitive or restricted content. An admin can add one manually from the Question Bank.';

async function explainAnswer({ question_text, options, correct_answers, subject, question_type }) {
  const correctList = Array.isArray(correct_answers) ? correct_answers : [];
  const isEssayLike = question_type === 'essay' || (!options?.length && correctList.length === 0);

  const buildPrompt = (softened) => {
    const neutralityNote = softened
      ? `\n\nNote: treat this strictly as a neutral, factual exam-prep question. Don't take or imply any political position, opinion, or stance on any party, figure, or current event — explain only the reasoning/model answer a standard civics/government textbook would give, the same way you'd explain a history or economics question.\n`
      : '';
    return isEssayLike
    ? `You are an experienced ${subject || ''} exam tutor. A student just attempted this theory/essay question and wants a model answer to study from.
${neutralityNote}
Question: ${question_text}

This question may have multiple lettered parts — e.g. (a), (b), (c) — possibly itself further broken into (i), (ii). Address EVERY part, in the same order and using the same labels the question uses.

For any part that requires calculation: show the actual worked steps (not just a description of the method) and state the final numeric/algebraic answer clearly at the end of that part — exactly as a student would need to write it out for full marks, not a summary of the approach.

For any part that is genuinely open-ended/descriptive (no single correct answer, e.g. discuss, explain, describe): give a strong, well-structured model answer covering the key points an examiner would look for.

Suitable for a West African secondary school student preparing for WAEC/JAMB/NECO. Be complete but not padded — cover every part fully, without unnecessary repetition.

Write any mathematical content as LaTeX wrapped in single dollar signs, e.g. $x^2 + 3x - 4 = 0$, $\\frac{1}{2}$, $30^\\circ$ — this gets rendered with a real math typesetting engine, so don't convert it to Unicode or plain text yourself. Put each lettered part on its own line.

Respond in JSON only (no markdown, no backticks):
{
  "explanation": "..."
}`
    : `You are an experienced ${subject || ''} exam tutor. A student just answered this question and wants to understand how the correct answer is reached.
${neutralityNote}
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
  };

  // One Gemini call, reporting whether it was CONTENT-BLOCKED (a verdict, not
  // an error — retrying the exact same prompt would get the exact same
  // verdict) as distinct from a normal successful/empty response.
  const attemptOnce = async (promptText) => {
    const response = await ai.models.generateContent({ model: MODEL, contents: promptText });
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      return { blocked: true, finishReason };
    }
    const result = extractJSON(response.text);
    return { blocked: false, explanation: result.explanation || '' };
  };

  const prompt = buildPrompt(false);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const outcome = await attemptOnce(prompt);

      if (outcome.blocked) {
        // Content-safety block, not a transient failure — burning the
        // remaining retries on an identical prompt won't help. Government/
        // civics/history content is the likeliest trigger (real political
        // figures, parties, events), so try exactly once with an explicit
        // neutrality reframing, which often clears an overzealous filter on
        // otherwise ordinary exam content. If that ALSO gets blocked, this
        // genuinely needs a human to write it — stop here rather than
        // hammering the API on every future page view for a verdict that
        // won't change.
        console.error(`explainAnswer blocked by Gemini (finishReason=${outcome.finishReason}), subject=${subject || 'unknown'} — trying one neutrally-reframed retry before giving up.`);
        try {
          const softened = await attemptOnce(buildPrompt(true));
          if (!softened.blocked && softened.explanation) return softened.explanation;
          console.error(`explainAnswer still blocked after neutral reframing (finishReason=${softened.finishReason || 'empty response'}) — this question needs a manually-written explanation.`);
        } catch (softenedErr) {
          console.error('explainAnswer softened retry threw:', softenedErr.message);
        }
        return EXPLANATION_BLOCKED_MARKER;
      }

      if (outcome.explanation) return outcome.explanation;
      lastErr = new Error('AI returned no explanation field');
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 800 * attempt));
  }
  console.error('explainAnswer failed after retries:', lastErr?.message);
  return '';
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
  locateQuestionDiagram,
  generateTopicContent,
  solveObjectiveQuestion,
  explainAnswer,
  chatWithStudyAssistant,
  reconstructDiagramSVG,
  qualityCheckDiagram,
  parseGeminiError,
  EXPLANATION_BLOCKED_MARKER,
};
