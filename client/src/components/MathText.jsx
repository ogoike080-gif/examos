import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Splits text on $...$ delimited math segments and renders each with KaTeX;
// everything outside $...$ renders as plain text.
//
// Deliberately conservative about layout impact: if the text has no $...$
// math in it at all (the common case for most already-imported content,
// since legacy data was Unicode-flattened rather than kept as LaTeX), this
// returns the raw string with NO wrapping element and NO forced styles —
// identical to what {text} would have rendered before this component
// existed. A forced whiteSpace:'pre-wrap' wrapper on every single call site
// (including inline option buttons inside flex rows) was the actual cause
// of a mobile layout regression — option text collapsing into a vertical
// one-word-per-line stack — so nothing is added unless there's real math to
// render, and even then the wrapper stays a plain inline span with no
// forced whiteSpace unless the caller's own `style` prop asks for it.
export default function MathText({ text, style, inline }) {
  if (text === null || text === undefined || text === '') return null;
  const str = String(text);

  if (!str.includes('$')) {
    // No math at all — render exactly as plain text, no wrapper.
    return style ? <span style={style}>{str}</span> : str;
  }

  const parts = str.split(/(\$[^$]+\$)/g);
  const content = parts.map((part, i) => {
    if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) {
      const math = part.slice(1, -1).trim();
      if (!math) return part;
      // KaTeX's bundled math fonts cover the common currency symbols ($ £ €
      // ¥) but not the Naira sign (₦, U+20A6) — very likely to show up given
      // this app's Nigerian curriculum content (profit/loss, interest,
      // currency word problems). Rendering it normally throws "Unrecognized
      // Unicode character" / "No character metrics" warnings and silently
      // drops the glyph. \unicode{...} sidesteps KaTeX's own font metrics
      // entirely and draws the raw codepoint using the browser's own font,
      // which does have it.
      const mathSafe = math.replace(/₦/g, '\\unicode{x20A6}');
      try {
        const html = katex.renderToString(mathSafe, { throwOnError: false, output: 'htmlAndMathml' });
        // eslint-disable-next-line react/no-danger
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        return <span key={i}>{part}</span>;
      }
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });

  return <span style={style}>{content}</span>;
}
