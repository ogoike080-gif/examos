// AI vision extraction sometimes outputs LaTeX-style math markup ($18^\circ$,
// x^2, \frac{a}{b}) since that's a common way math appears in its training
// data. The client used to have no LaTeX renderer, so this used to flatten
// ALL of it (including inside $...$) to plain Unicode. That's no longer
// true — MathText.jsx now renders $...$ spans with real KaTeX — so this
// must NOT touch anything inside a $...$ delimiter, or it destroys real,
// correctly-typeset math (collapsing fractions, losing structure) in favor
// of a worse Unicode approximation.
//
// What this still does, and why it's still useful: vision extraction
// occasionally emits a LaTeX macro OUTSIDE any $...$ wrapper (e.g. it wrote
// "the angle is \circ 30" instead of wrapping the math), which would
// otherwise show a raw backslash to students. Those stray, unwrapped cases
// still get flattened to Unicode. Anything already inside $...$ is left
// completely alone for KaTeX to render.

const SUPERSCRIPT_DIGITS = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻' };

function toSuperscript(digits) {
  return digits.split('').map(d => SUPERSCRIPT_DIGITS[d] || d).join('');
}

// Flattens stray (non-$-wrapped) LaTeX macros to Unicode. Never called on
// text that's inside a $...$ span — see cleanMathNotation below.
function flattenStrayLatex(text) {
  // \frac{a}{b} -> a/b (simple, non-nested cases — covers the vast majority
  // of exam-paper fractions)
  text = text.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');

  // \sqrt{x} -> √(x), \sqrt[n]{x} -> ⁿ√(x) left as "n√(x)" (plain digit, not
  // worth a full superscript-root Unicode hunt for a rare case)
  text = text.replace(/\\sqrt\[(\d+)\]\{([^{}]+)\}/g, '$1√($2)');
  text = text.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');

  // Common symbol macros
  text = text
    .replace(/\\circ/g, '°')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\cdot/g, '·')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\infty/g, '∞')
    .replace(/\\pi/g, 'π')
    .replace(/\\theta/g, 'θ')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\degree/g, '°');

  // Exponents: ^2 -> ², ^{12} -> ¹², ^-1 -> ⁻¹. Falls back to just removing
  // the caret for anything not purely numeric (e.g. ^n stays as "n" plainly
  // appended) rather than leaving a stray backslash-free caret in the text.
  text = text.replace(/\^\{(-?\d+)\}/g, (_, d) => toSuperscript(d));
  text = text.replace(/\^(-?\d+)/g, (_, d) => toSuperscript(d));
  text = text.replace(/\^\{([^{}]+)\}/g, '$1');
  text = text.replace(/\^(\w)/g, '$1');

  // Subscripts: keep as plain digits (H_2O -> H2O) — subscript unicode digits
  // render poorly/inconsistently across fonts compared to superscripts, and
  // "H2O" is unambiguous without them.
  text = text.replace(/_\{(-?\w+)\}/g, '$1');
  text = text.replace(/_(-?\w)/g, '$1');

  // Any leftover caret — e.g. from "^\circ" where \circ converts to ° after
  // the digit-exponent regex already ran and found nothing numeric to match.
  // Whatever's left is noise; the meaningful conversion already happened.
  text = text.replace(/\^/g, '');

  // Any remaining unhandled macro (\something) — strip the backslash and
  // keep the word rather than showing a stray backslash to students.
  text = text.replace(/\\([a-zA-Z]+)/g, '$1');
  text = text.replace(/[{}]/g, '');

  return text;
}

function cleanMathNotation(input) {
  if (typeof input !== 'string' || (!input.includes('\\') && !input.includes('$'))) return input;

  // Split on $...$ spans and only flatten the parts OUTSIDE them. Anything
  // inside $...$ is real LaTeX the client renders with KaTeX — leave it
  // completely untouched, delimiters included.
  const parts = input.split(/(\$[^$]+\$)/g);
  const text = parts
    .map((part) => {
      if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) return part;
      return part.includes('\\') ? flattenStrayLatex(part) : part;
    })
    .join('');

  return text.replace(/\s+/g, ' ').trim();
}

// Applies cleanMathNotation across a question object's text-bearing fields —
// question_text, each option, and explanation. Safe to call on partial
// objects (missing fields are skipped).
function cleanQuestionFields(q) {
  if (!q || typeof q !== 'object') return q;
  const cleaned = { ...q };
  if (typeof cleaned.question_text === 'string') cleaned.question_text = cleanMathNotation(cleaned.question_text);
  if (Array.isArray(cleaned.options)) cleaned.options = cleaned.options.map(o => typeof o === 'string' ? cleanMathNotation(o) : o);
  if (typeof cleaned.explanation === 'string') cleaned.explanation = cleanMathNotation(cleaned.explanation);
  return cleaned;
}

module.exports = { cleanMathNotation, cleanQuestionFields };
