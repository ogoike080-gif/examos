import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// KaTeX's bundled math fonts cover the common currency symbols ($ £ € ¥) but
// not the Naira sign (₦, U+20A6) — very likely to show up given this app's
// Nigerian curriculum content (profit/loss, interest, currency word
// problems). Rendering it normally throws "Unrecognized Unicode character" /
// "No character metrics" warnings and silently drops the glyph.
// \unicode{...} sidesteps KaTeX's own font metrics entirely and draws the
// raw codepoint using the browser's own font, which does have it.
function makeKatexSafe(math) {
  return math.replace(/₦/g, '\\unicode{x20A6}');
}

function renderKatex(math, key) {
  try {
    const html = katex.renderToString(makeKatexSafe(math), { throwOnError: false, output: 'htmlAndMathml' });
    // eslint-disable-next-line react/no-danger
    return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return null; // caller falls back to the raw text
  }
}

// Matches a LaTeX macro that was never wrapped in $...$ at all — \bar{4},
// \sqrt{25}, \frac{1}{2}, \circ, etc. This is a distinct, real failure mode
// from the mixed-escaping JSON bug (see extractJSON in questionGenerator.js):
// that one is about a macro surviving JSON parsing correctly but arriving
// with $ delimiters; this one is the extraction model forgetting to wrap
// certain answers in $...$ in the first place — WAEC-style logarithm
// "bar notation" answers (4̄.1986, written as \bar{4}.1986) are the most
// commonly observed case, since they look more like plain numeric answer
// choices than "math" to the model, but any macro can slip through this way.
// Deliberately requires the macro name to be 2+ letters — this keeps a
// literal Windows-style path fragment like "C:\Users\x" from ever matching
// (single-letter tokens like \U aren't real LaTeX macros in this app's
// content anyway), while still catching every real macro name in use here.
const STRAY_MACRO = /\\[a-zA-Z]{2,}(?:\{[^{}]*\})*/g;

// Renders a plain-text segment (no $...$ in it) that may still contain stray,
// unwrapped LaTeX macros — auto-wraps just those tokens for KaTeX and leaves
// everything else (including e.g. the ".1986" right after a \bar{4}) as
// ordinary text, so a run like "\bar{4}.1986" renders as an actual overlined
// 4 followed by plain ".1986", matching what the original answer meant.
function renderPlainSegment(text, keyPrefix) {
  if (!STRAY_MACRO.test(text)) return text;
  STRAY_MACRO.lastIndex = 0; // reset after .test()'s side effect on a global regex

  const pieces = [];
  let lastIndex = 0;
  let m;
  let i = 0;
  while ((m = STRAY_MACRO.exec(text)) !== null) {
    if (m.index > lastIndex) pieces.push(text.slice(lastIndex, m.index));
    const rendered = renderKatex(m[0], `${keyPrefix}-${i}`);
    pieces.push(rendered || m[0]); // fall back to the raw macro text if KaTeX itself rejects it
    lastIndex = m.index + m[0].length;
    i++;
  }
  if (lastIndex < text.length) pieces.push(text.slice(lastIndex));
  return pieces;
}

// Splits text on $...$ delimited math segments and renders each with KaTeX;
// everything outside $...$ renders as plain text — EXCEPT for stray,
// unwrapped LaTeX macros (see STRAY_MACRO above), which get auto-wrapped and
// rendered too rather than shown as raw backslash syntax.
//
// Deliberately conservative about layout impact: if the text has no $...$
// math AND no stray macro in it at all (the common case for most
// already-imported content, since legacy data was Unicode-flattened rather
// than kept as LaTeX), this returns the raw string with NO wrapping element
// and NO forced styles — identical to what {text} would have rendered before
// this component existed. A forced whiteSpace:'pre-wrap' wrapper on every
// single call site (including inline option buttons inside flex rows) was
// the actual cause of a mobile layout regression — option text collapsing
// into a vertical one-word-per-line stack — so nothing is added unless
// there's real math to render, and even then the wrapper stays a plain
// inline span with no forced whiteSpace unless the caller's own `style` prop
// asks for it.
export default function MathText({ text, style, inline }) {
  if (text === null || text === undefined || text === '') return null;
  const str = String(text);

  const hasDollarMath = str.includes('$');
  const hasStrayMacro = STRAY_MACRO.test(str);
  STRAY_MACRO.lastIndex = 0;

  if (!hasDollarMath && !hasStrayMacro) {
    // No math at all — render exactly as plain text, no wrapper.
    return style ? <span style={style}>{str}</span> : str;
  }

  if (!hasDollarMath) {
    // Stray macros only, no $...$ anywhere — render the whole string through
    // the stray-macro path directly.
    return <span style={style}>{renderPlainSegment(str, 'stray')}</span>;
  }

  const parts = str.split(/(\$[^$]+\$)/g);
  const content = parts.map((part, i) => {
    if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) {
      const math = part.slice(1, -1).trim();
      if (!math) return part;
      const rendered = renderKatex(math, i);
      return rendered || <span key={i}>{part}</span>;
    }
    // A "plain" segment between/around $...$ spans can still itself contain
    // a stray macro the extraction forgot to wrap — check it the same way.
    return <React.Fragment key={i}>{renderPlainSegment(part, `seg-${i}`)}</React.Fragment>;
  });

  return <span style={style}>{content}</span>;
}
