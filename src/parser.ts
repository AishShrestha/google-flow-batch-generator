// src/parser.ts - Markdown prompt parser
// Extracts Image Prompt sections from the narration Markdown format.

import { readFile } from 'fs/promises';
import { ImagePrompt } from './types.js';

/**
 * Remove surrounding quotation marks (straight or curly) from a string.
 * Handles: " " ' ' ' ' « » and pairs of them.
 */
export function stripQuotes(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // Pairs of quotes to strip (outermost only)
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ['\u201C', '\u201D'], // " "
    ['\u2018', '\u2019'], // ' '
    ['\u00AB', '\u00BB'], // « »
    ["'", "'"],
  ];

  for (const [open, close] of quotePairs) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, -close.length).trim();
    }
  }

  return trimmed;
}

/**
 * Parse Markdown content and extract image prompts.
 *
 * The format is:
 * [Lxx] LINE N:
 * Original Script Line:
 * "Some narration text."
 *
 * Image Prompt:
 * "The prompt text..."
 *
 * The parser detects `Image Prompt:` lines and captures the text that follows,
 * until the next section marker or end of file.
 */
export function parseMarkdown(content: string): ImagePrompt[] {
  const lines = content.split('\n');
  const prompts: ImagePrompt[] = [];
  let currentIndex = 0;
  let currentScriptLine: string | undefined;
  let inImagePrompt = false;
  let promptLines: string[] = [];

  const flushPrompt = () => {
    if (inImagePrompt && promptLines.length > 0) {
      const rawPrompt = promptLines.join('\n').trim();
      const cleanPrompt = stripQuotes(rawPrompt);
      if (cleanPrompt) {
        currentIndex++;
        prompts.push({
          index: currentIndex,
          scriptLine: currentScriptLine,
          prompt: cleanPrompt,
        });
      }
    }
    promptLines = [];
    inImagePrompt = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Detect "Image Prompt:" header
    if (/^Image\s*Prompt\s*:?\s*$/i.test(trimmedLine)) {
      flushPrompt(); // save previous prompt if any
      inImagePrompt = true;
      promptLines = [];
      continue;
    }

    // Detect "Original Script Line:" header
    if (/^Original\s*Script\s*Line\s*:?\s*$/i.test(trimmedLine)) {
      // Next non-empty line is the script line
      const scriptText = collectQuotedText(lines, i + 1);
      if (scriptText) {
        currentScriptLine = scriptText;
      }
      continue;
    }

    // Detect section markers like [L1], [L9], LINE 1:, etc.
    if (/^\[L\d+\]/i.test(trimmedLine) || /^LINE\s+\d+\s*:/i.test(trimmedLine)) {
      flushPrompt();
      currentScriptLine = undefined;
      continue;
    }

    // Detect Markdown separator
    if (/^---+\s*$/.test(trimmedLine) || /^\*\*\*+\s*$/.test(trimmedLine)) {
      flushPrompt();
      continue;
    }

    // If we're inside an Image Prompt section, collect lines
    if (inImagePrompt) {
      // Skip empty lines only if we haven't collected any content yet
      if (trimmedLine === '' && promptLines.length === 0) {
        continue;
      }
      promptLines.push(line);
    }
  }

  // Flush the last prompt
  flushPrompt();

  return prompts;
}

/**
 * Collect quoted text from a position, handling multiline and curly quotes.
 * Returns the text with quotes stripped.
 */
function collectQuotedText(lines: string[], startIdx: number): string | null {
  const collected: string[] = [];
  let foundStart = false;
  let quoteOpen = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line && !foundStart) continue;
    if (!line && foundStart && !quoteOpen) break;

    // Check for section markers or new headers
    if (/^Image\s*Prompt/i.test(line) || /^\[L\d+\]/i.test(line) || /^LINE\s+\d+/i.test(line)) {
      break;
    }

    collected.push(lines[i]);

    // Check if this line has closing quotes
    const hasOpenCurly = line.includes('\u201C') || line.includes('"');
    const hasCloseCurly = line.includes('\u201D') || (line.includes('"') && !line.startsWith('"'));

    if (hasOpenCurly && !foundStart) {
      foundStart = true;
      quoteOpen = !hasCloseCurly || (line.indexOf('\u201C') < line.lastIndexOf('\u201D'));
    } else if (hasOpenCurly) {
      quoteOpen = !hasCloseCurly;
    }

    if (foundStart && !quoteOpen && (line.endsWith('"') || line.endsWith('\u201D') || line.endsWith('"'))) {
      break;
    }

    // Single line with quotes
    if (!foundStart && (line.startsWith('"') || line.startsWith('\u201C') || line.startsWith('"'))) {
      foundStart = true;
      if (line.endsWith('"') || line.endsWith('\u201D') || line.endsWith('"')) {
        break;
      }
      quoteOpen = true;
    }

    // Non-quoted single line
    if (!foundStart && !line.startsWith('"') && !line.startsWith('\u201C')) {
      collected.length = 0;
      collected.push(lines[i]);
      if (line) break;
    }
  }

  if (collected.length === 0) return null;
  return stripQuotes(collected.join('\n').trim());
}

/**
 * Read a Markdown file and parse all image prompts.
 */
export async function parseFile(filePath: string): Promise<ImagePrompt[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseMarkdown(content);
}