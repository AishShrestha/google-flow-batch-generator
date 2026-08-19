// tests/parser.test.ts - Parser tests

import { describe, it, expect } from 'vitest';
import { parseMarkdown, stripQuotes } from '../src/parser.js';

describe('stripQuotes', () => {
  it('removes straight double quotes', () => {
    expect(stripQuotes('"Hello world."')).toBe('Hello world.');
  });

  it('removes curly double quotes', () => {
    expect(stripQuotes('\u201CHello world.\u201D')).toBe('Hello world.');
  });

  it('removes straight single quotes', () => {
    expect(stripQuotes("'Hello world.'")).toBe('Hello world.');
  });

  it('removes curly single quotes', () => {
    expect(stripQuotes('\u2018Hello world.\u2019')).toBe('Hello world.');
  });

  it('does not remove quotes that are not outermost', () => {
    expect(stripQuotes('Hello "world"')).toBe('Hello "world"');
  });

  it('handles empty string', () => {
    expect(stripQuotes('')).toBe('');
  });

  it('handles text without quotes', () => {
    expect(stripQuotes('Hello world')).toBe('Hello world');
  });
});

describe('parseMarkdown', () => {
  it('parses a single prompt', () => {
    const md = `
[L1] LINE 1:
Original Script Line:
"There's a strange moment."

Image Prompt:
"Minimalist psychology animation style, clean white background."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
    expect(result[0].prompt).toBe('Minimalist psychology animation style, clean white background.');
  });

  it('parses multiple prompts', () => {
    const md = `
[L1] LINE 1:
Original Script Line:
"First line."

Image Prompt:
"First prompt."

[L2] LINE 2:
Original Script Line:
"Second line."

Image Prompt:
"Second prompt."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe('First prompt.');
    expect(result[1].prompt).toBe('Second prompt.');
  });

  it('parses 20 prompts', () => {
    let md = '';
    for (let i = 1; i <= 20; i++) {
      md += `
[L${i}] LINE ${i}:
Original Script Line:
"Script line ${i}."

Image Prompt:
"Prompt number ${i}."
`;
    }
    const result = parseMarkdown(md);
    expect(result).toHaveLength(20);
    expect(result[19].index).toBe(20);
    expect(result[19].prompt).toBe('Prompt number 20.');
  });

  it('handles multiline prompts', () => {
    const md = `
Image Prompt:
"Line one of the prompt.
Line two of the prompt.
Line three of the prompt."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toContain('Line one');
    expect(result[0].prompt).toContain('Line two');
    expect(result[0].prompt).toContain('Line three');
  });

  it('handles curly quotes', () => {
    const md = `
Image Prompt:
\u201CMinimalist style, clean background.\u201D
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Minimalist style, clean background.');
  });

  it('handles missing prompt (no Image Prompt section)', () => {
    const md = `
[L1] LINE 1:
Original Script Line:
"Just a script line, no prompt."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(0);
  });

  it('handles empty prompt', () => {
    const md = `
Image Prompt:
""
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(0);
  });

  it('handles markdown separators', () => {
    const md = `
[L1] LINE 1:
Original Script Line:
"First."

Image Prompt:
"First prompt."

---

[L2] LINE 2:
Original Script Line:
"Second."

Image Prompt:
"Second prompt."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(2);
    expect(result[0].prompt).toBe('First prompt.');
    expect(result[1].prompt).toBe('Second prompt.');
  });

  it('handles [Lxx] markers', () => {
    const md = `
[L1] LINE 1:
Original Script Line:
"First."

Image Prompt:
"First prompt."

[L99] LINE 2:
Original Script Line:
"Second."

Image Prompt:
"Second prompt."

[L500] LINE 3:
Original Script Line:
"Third."

Image Prompt:
"Third prompt."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(3);
    expect(result[2].prompt).toBe('Third prompt.');
  });

  it('handles prompt containing quotation marks', () => {
    const md = `
Image Prompt:
"A drawing of a person saying \\"hello\\" to the world."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toContain('hello');
  });

  it('preserves prompt order', () => {
    const md = `
Image Prompt:
"Alpha."

Image Prompt:
"Beta."

Image Prompt:
"Gamma."

Image Prompt:
"Delta."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(4);
    expect(result[0].prompt).toBe('Alpha.');
    expect(result[1].prompt).toBe('Beta.');
    expect(result[2].prompt).toBe('Gamma.');
    expect(result[3].prompt).toBe('Delta.');
  });

  it('handles prompts without quotes', () => {
    const md = `
Image Prompt:
Minimalist style without any quotes at all.
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Minimalist style without any quotes at all.');
  });

  it('does not truncate long prompts', () => {
    const longPrompt = 'A'.repeat(2000);
    const md = `
Image Prompt:
"${longPrompt}"
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe(longPrompt);
  });

  it('extracts script lines', () => {
    const md = `
[L1] LINE 1:
Original Script Line:
"There's a strange moment."

Image Prompt:
"First prompt."
`;
    const result = parseMarkdown(md);
    expect(result).toHaveLength(1);
    expect(result[0].scriptLine).toBe("There's a strange moment.");
  });
});