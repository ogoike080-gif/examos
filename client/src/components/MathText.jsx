import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Splits text on $...$ delimited math segments and renders each with KaTeX;
// everything outside $...$ renders as plain text. Used anywhere question
// text, options, or explanations are shown, so imported math notation
// ($x^2$, $\frac{1}{2}$, $30^\circ$) renders as real typeset math instead of
// either raw LaTeX syntax or a flattened Unicode approximation.
//
// throwOnError: false means a malformed LaTeX segment (which can happen —
// AI-extracted math isn't always perfectly formed) degrades to showing the
// raw $...$ text rather than crashing the question display for the student.
export default function MathText({ text, style, inline = false }) {
  if (text === null || text === undefined || text === '') return null;

  const parts = String(text).split(/(\$[^$]+\$)/g);

  const content = parts.map((part, i) => {
    if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) {
      const math = part.slice(1, -1).trim();
      if (!math) return part;
      try {
        const html = katex.renderToString(math, { throwOnError: false, output: 'htmlAndMathml' });
        // eslint-disable-next-line react/no-danger
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        return <span key={i}>{part}</span>;
      }
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });

  const Tag = inline ? 'span' : 'span';
  return <Tag style={{ whiteSpace: 'pre-wrap', ...style }}>{content}</Tag>;
}
