// src/prompt-gen.ts - Gemini prompt generation via browser automation
// Mirrors flow.ts pattern: persistent profile, scan iframes, poll for completion.

import { chromium, BrowserContext, Page, Locator } from 'playwright';
import { GeminiConfig } from './types.js';
import { Logger } from './logger.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const MASTER_PROMPT_PATH = 'prompts/master-prompt.md';

const NEXT_MARKER = '=== TYPE "NEXT" FOR THE NEXT 20 PROMPTS ===';
const CONTINUATION_PROMPT = 'NEXT';

const MODEL_PICKER_SELECTOR = 'button[aria-label*="Model"], button[aria-label*="model"], [data-test-id*="model-selector"]';
const CHAT_INPUT_SELECTOR = '.ql-editor[contenteditable="true"], rich-textarea .ql-editor, div[contenteditable="true"]';
const SUBMIT_BUTTON_SELECTOR = 'button[aria-label="Send message"], button:has-text("Send"), mat-icon:has-text("send"), button.send-button';
// Stop button appears while Gemini is generating — waiting for it to vanish = generation done
const STOP_BUTTON_SELECTOR = 'button[aria-label*="Stop"], button[aria-label*="stop"], button.stop-button, button:has-text("Stop")';

export class GeminiPromptGenerator {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: GeminiConfig;
  private logger: Logger;

  constructor(config: GeminiConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    this.logger.status('Starting Gemini browser...');

    this.context = await chromium.launchPersistentContext(this.config.profileDir, {
      headless: this.config.headless,
      viewport: { width: this.config.viewportWidth, height: this.config.viewportHeight },
      channel: 'chrome',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        // ponytail: clipboard access for copy-button response extraction
        '--enable-clipboard-read',
        '--enable-clipboard-write',
      ],
    });

    // Grant clipboard permission
    await this.context.grantPermissions(['clipboard-read', 'clipboard-write']);

    this.page = await this.context.newPage();
    await this.page.setDefaultTimeout(this.config.timeoutMs);

    this.logger.success('Gemini browser started.');
  }

  async ensureLoggedIn(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    this.logger.status(`Navigating to ${this.config.url}...`);
    // ponytail: domcontentloaded not networkidle — Gemini SPA keeps network alive
    await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(3000);

    const currentUrl = this.page.url();
    this.logger.status(`Current URL: ${currentUrl}`);

    const isLoginPage = currentUrl.includes('accounts.google.com') ||
      (await this.page.locator('input[type="email"]').count()) > 0;

    if (isLoginPage) {
      this.logger.loginRequired();
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      await new Promise<void>((resolve) => {
        rl.question('', () => { rl.close(); resolve(); });
      });

      await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      if (this.page.url().includes('accounts.google.com')) {
        throw new Error('Still on login page. Please log in first.');
      }
    }

    this.logger.loginDetected();
    this.logger.status('Waiting for chat UI to settle...');
    await this.page.waitForTimeout(2000);
  }

  async selectModel(modelName: string): Promise<boolean> {
    if (!this.page) return false;

    // Try to find and click the model picker
    const picker = this.page.locator(MODEL_PICKER_SELECTOR).first();
    const pickerVisible = await picker.isVisible().catch(() => false);

    if (!pickerVisible) {
      this.logger.warn(`Model picker not found; using default model.`);
      return false;
    }

    await picker.click();
    await this.page.waitForTimeout(500);

    // Find the model option matching the requested name
    const option = this.page.locator(`[role="menuitem"], [role="option"], button`).filter({ hasText: modelName }).first();
    const optionVisible = await option.isVisible().catch(() => false);

    if (optionVisible) {
      await option.click();
      this.logger.status(`Model selected: ${modelName}`);
      return true;
    }

    this.logger.warn(`Model "${modelName}" not found in picker; using default.`);
    // Close the picker if it's still open
    await this.page.keyboard.press('Escape').catch(() => {});
    return false;
  }

  async findInputElement(): Promise<Locator | null> {
    if (!this.page) return null;

    for (const frame of this.page.frames()) {
      for (const selector of CHAT_INPUT_SELECTOR.split(',')) {
        const loc = frame.locator(selector.trim()).first();
        const visible = await loc.isVisible().catch(() => false);
        if (visible) return loc;
      }
    }
    return null;
  }

  async findSubmitButton(): Promise<Locator | null> {
    if (!this.page) return null;

    for (const frame of this.page.frames()) {
      for (const selector of SUBMIT_BUTTON_SELECTOR.split(',')) {
        const loc = frame.locator(selector.trim()).first();
        const visible = await loc.isVisible().catch(() => false);
        if (visible) return loc;
      }
    }
    return null;
  }

  async sendPrompt(message: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    this.logger.status('Finding chat input...');
    const input = await this.findInputElement();
    if (!input) {
      throw new Error('Could not locate Gemini chat input. Run `pnpm gen-prompts --inspect` to debug.');
    }

    // ponytail: Quill editor is contenteditable, .fill() and keyboard.type fail.
    // keyboard.type sends Enter for \n which submits prematurely.
    // execCommand insertText preserves newlines without triggering submit.
    await input.click();
    await this.page.waitForTimeout(200);

    // Clear any existing content — Meta+A on Mac, Control+A elsewhere
    const isMac = process.platform === 'darwin';
    await this.page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await this.page.waitForTimeout(50);
    await this.page.keyboard.press('Delete');

    this.logger.status(`Inserting message (${message.length} chars)...`);
    // execCommand insertText fires input event that Quill's model listens to
    const inserted = await this.page.evaluate((msg) => {
      return document.execCommand('insertText', false, msg);
    }, message);

    if (!inserted) {
      // Fallback: set innerText + dispatch input event
      await input.evaluate((el, msg) => {
        (el as HTMLElement).innerText = msg;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, message);
    }

    this.logger.status('Sending message...');
    // Try multiple submit strategies — Enter in Quill sends if shift not held
    const submit = await this.findSubmitButton();
    if (submit) {
      await submit.click();
    } else {
      // Contenteditable: plain Enter sends in Gemini (enterKeyHint="send")
      await this.page.keyboard.press('Enter');
    }
  }

  async waitForResponse(timeoutMs?: number): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');

    const timeout = timeoutMs ?? this.config.timeoutMs;
    const startTime = Date.now();

    // Reset streaming tracker
    this.prevBodyLength = 0;
    this.stableCount = 0;

    this.logger.status('Waiting for Gemini response to start...');

    // Phase 1: wait for body text to start growing (response appearing)
    const initialBodyLen = await this.page.evaluate(() => document.body?.textContent?.length || 0);
    let responseStarted = false;
    while (Date.now() - startTime < timeout) {
      const errorText = await this.getErrorText();
      if (errorText) throw new Error(`Gemini error: ${errorText}`);

      const currentLen = await this.page.evaluate(() => document.body?.textContent?.length || 0);
      if (currentLen > initialBodyLen + 20) {
        responseStarted = true;
        break;
      }
      await this.page.waitForTimeout(1000);
    }

    if (!responseStarted) {
      throw new Error('Gemini response never started.');
    }

    this.logger.status('Response started, waiting for completion...');

    // Phase 2: wait for completion — stop button gone AND text stable
    while (Date.now() - startTime < timeout) {
      const errorText = await this.getErrorText();
      if (errorText) throw new Error(`Gemini error: ${errorText}`);

      const done = await this.isGenerationDone();
      if (done) break;

      await this.page.waitForTimeout(1000);
    }

    this.logger.status('Response complete, extracting via copy button...');

    // Phase 3: click copy button on latest response, read clipboard
    const responseText = await this.extractResponseViaCopy();

    if (!responseText || responseText.length < 50) {
      throw new Error(`Copy extraction returned empty/short text (${responseText.length} chars).`);
    }

    this.logger.status(`Extracted ${responseText.length} chars from clipboard.`);
    return responseText;
  }

  /**
   * Check if generation is done: no stop button visible AND response has NEXT marker or stopped growing.
   */
  private prevBodyLength: number = 0;
  private stableCount: number = 0;

  private async isGenerationDone(): Promise<boolean> {
    if (!this.page) return false;

    // Stop button visible = still generating
    const hasStop = await this.page.locator(STOP_BUTTON_SELECTOR).first().isVisible().catch(() => false);
    if (hasStop) {
      this.stableCount = 0;
      return false;
    }

    // No stop button — check if body text has NEXT marker or stopped growing
    const bodyText = await this.page.evaluate(() => document.body?.textContent || '');
    const hasNextMarker = bodyText.includes('=== TYPE "NEXT"');
    if (hasNextMarker) return true;

    // Track body length stability — if not growing for 5 polls, done
    const currentLen = bodyText.length;
    if (currentLen > this.prevBodyLength) {
      this.stableCount = 0;
    } else {
      this.stableCount++;
    }
    this.prevBodyLength = currentLen;

    return this.stableCount >= 5;
  }

  private async getErrorText(): Promise<string | null> {
    if (!this.page) return null;
    try {
      return await this.page.evaluate(() => {
        const el = document.querySelector('[role="alert"], .error-message, [data-test-id*="error"]');
        return el ? (el.textContent || '').trim() : null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Click the copy button on the latest Gemini response, read clipboard.
   * More robust than DOM scraping — gets exactly what Gemini rendered.
   */
  async extractResponseViaCopy(): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');

    // ponytail: clear clipboard first so we can detect if copy actually wrote something new.
    // Without this, stale clipboard content (from sendPrompt's insertText) gets returned.
    await this.page.evaluate(() => navigator.clipboard.writeText(''));

    // ponytail: Gemini shows copy buttons on BOTH user and model messages.
    // Target only the model response area — look for copy buttons after user messages.
    // Strategy: find all copy buttons, click the LAST one (latest = model response).
    const copySelectors = [
      'button[aria-label*="Copy"]',
      'button[aria-label*="copy"]',
      'button:has-text("Copy")',
      '[data-test-id*="copy"]',
      'button.copy-button',
      'mat-icon:has-text("content_copy")',
      'button[mattooltip*="Copy"]',
    ];

    let clicked = false;
    let usedSelector = '';
    for (const selector of copySelectors) {
      // Get count — need at least 2 (one for user msg, one for model response)
      const count = await this.page.locator(selector).count().catch(() => 0);
      if (count >= 2) {
        // Click the last one — model response comes after user message
        await this.page.locator(selector).last().click();
        clicked = true;
        usedSelector = selector;
        break;
      } else if (count === 1) {
        // Only one copy button — might be the response if user msg has none
        await this.page.locator(selector).click();
        clicked = true;
        usedSelector = selector;
        break;
      }
    }

    if (!clicked) {
      throw new Error('Could not find copy button. Run `pnpm gen-prompts:inspect` to verify selector.');
    }

    this.logger.status(`Clicked copy button: ${usedSelector}`);

    // Wait for clipboard to populate
    await this.page.waitForTimeout(800);

    // Read clipboard
    const clipboardText = await this.page.evaluate(() => navigator.clipboard.readText());

    if (!clipboardText || clipboardText.length < 50) {
      throw new Error(`Clipboard empty or too short (${clipboardText.length} chars). Copy button may not have worked.`);
    }

    return clipboardText;
  }

  /**
   * Wait for the stop button to appear (generation started) then vanish (generation done).
   * If generation already finished (stop button never appears within grace period),
   * assume done and proceed.
   */
  async waitForGenerationDone(timeoutMs?: number): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    const timeout = timeoutMs ?? this.config.timeoutMs;
    const startTime = Date.now();
    const gracePeriodMs = 5000; // ponytail: if no stop button in 5s, generation already done

    // Phase 1: wait for stop button to appear (generation started) — short grace
    this.logger.status('Waiting for generation to start...');
    let sawStopButton = false;
    while (Date.now() - startTime < gracePeriodMs) {
      const hasStop = await this.page.locator(STOP_BUTTON_SELECTOR).first().isVisible().catch(() => false);
      if (hasStop) {
        sawStopButton = true;
        break;
      }
      await this.page.waitForTimeout(500);
    }

    if (!sawStopButton) {
      this.logger.status('No stop button detected — generation already done.');
      return;
    }

    // Phase 2: wait for stop button to vanish (generation done)
    this.logger.status('Generation in progress, waiting for stop button to vanish...');
    while (Date.now() - startTime < timeout) {
      const hasStop = await this.page.locator(STOP_BUTTON_SELECTOR).first().isVisible().catch(() => false);
      if (!hasStop) {
        this.logger.status('Generation done (stop button gone).');
        return;
      }
      await this.page.waitForTimeout(1000);
    }

    throw new Error(`Generation did not finish within ${timeout / 1000}s.`);
  }

  async clearConversation(): Promise<void> {
    if (!this.page) return;
    // ponytail: domcontentloaded not networkidle — Gemini SPA keeps network alive
    await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(1500);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }

  getPage(): Page | null {
    return this.page;
  }
}

/**
 * Split a script into batches of `batchSize` lines.
 * Each line is a sentence or meaningful narration unit.
 */
export function splitIntoBatches(script: string, batchSize: number): string[][] {
  // Normalize whitespace, split into sentences
  const normalized = script.replace(/\r\n/g, '\n').trim();
  // Split on sentence boundaries and newlines
  const rawLines = normalized.split(/(?<=[.!?])\s+|\n+/);
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);

  const batches: string[][] = [];
  for (let i = 0; i < lines.length; i += batchSize) {
    batches.push(lines.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Build the message for a batch: master prompt + numbered lines.
 */
export function buildBatchMessage(lines: string[], batchNum: number, totalBatches: number): string {
  const numbered = lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  return `Batch ${batchNum}/${totalBatches}\n\nHere are the narration lines for this batch:\n\n${numbered}`;
}

/**
 * Parse a Gemini response and extract LINE N / Image Prompt pairs.
 * Validates format matches what the downstream parser expects.
 */
export function parseGeminiResponse(response: string): { line: string; prompt: string }[] {
  const results: { line: string; prompt: string }[] = [];

  // Split on LINE N: markers
  const blocks = response.split(/\n(?=LINE\s+\d+\s*:)/i);

  for (const block of blocks) {
    const lineMatch = block.match(/Original Script Line:\s*\n?"([^"]+)"/i);
    const promptMatch = block.match(/Image Prompt:\s*\n?"([^"]+)"/i);

    if (lineMatch && promptMatch) {
      results.push({
        line: lineMatch[1].trim(),
        prompt: promptMatch[1].trim(),
      });
    }
  }

  return results;
}

/**
 * Convert parsed pairs into the markdown format the downstream parser expects.
 */
export function pairsToMarkdown(pairs: { line: string; prompt: string }[], startIndex: number): string {
  const blocks: string[] = [];

  pairs.forEach((pair, i) => {
    const index = startIndex + i;
    blocks.push(`[L${index}] LINE ${index}:
Original Script Line:
"${pair.line}"

Image Prompt:
"${pair.prompt}"

---`);
  });

  return blocks.join('\n\n');
}

/**
 * Load the master prompt from disk.
 */
export async function loadMasterPrompt(): Promise<string> {
  return readFile(MASTER_PROMPT_PATH, 'utf-8');
}

/**
 * Generate all image prompts for a script by driving Gemini in batches.
 */
export async function generatePrompts(
  script: string,
  config: GeminiConfig,
  logger: Logger
): Promise<string> {
  const batches = splitIntoBatches(script, config.batchSize);
  const totalBatches = batches.length;

  logger.header('Gemini Prompt Generation');
  logger.config('Total batches', String(totalBatches));
  logger.config('Batch size', `${config.batchSize} lines`);
  logger.config('Model', config.model);
  logger.blank();

  const masterPrompt = await loadMasterPrompt();

  const gemini = new GeminiPromptGenerator(config, logger);
  const allMarkdown: string[] = [];
  let currentIndex = 1;

  try {
    await gemini.initialize();
    await gemini.ensureLoggedIn();
    await gemini.selectModel(config.model);

    // ponytail: single chat with NEXT continuation — history keeps style consistent
    // across batches. Page already loaded fresh by ensureLoggedIn, no clear needed.
    await gemini.selectModel(config.model);

    for (let b = 0; b < totalBatches; b++) {
      const batch = batches[b];
      const batchNum = b + 1;

      logger.section(`Batch ${batchNum}/${totalBatches} (${batch.length} lines)`);
      logger.status(`Lines ${currentIndex}–${currentIndex + batch.length - 1}`);

      // ponytail: every batch sends the actual lines — "NEXT" alone doesn't give Gemini
      // the script content to work with. History provides style context; lines provide content.
      let message: string;
      const batchMsg = buildBatchMessage(batch, batchNum, totalBatches);
      if (b === 0) {
        message = `${masterPrompt}\n\n${batchMsg}`;
      } else {
        message = `NEXT\n\n${batchMsg}`;
      }

      await gemini.sendPrompt(message);

      let response: string;
      try {
        response = await gemini.waitForResponse();
      } catch (err) {
        // ponytail: don't clear conversation on every failure — that reloads the page.
        // Just log and retry extraction once more before giving up.
        logger.warn(`Response extraction failed: ${(err as Error).message}`);
        logger.status('Waiting 5s and retrying extraction...');
        await new Promise((r) => setTimeout(r, 5000));
        response = await gemini.waitForResponse();
      }

      const pairs = parseGeminiResponse(response);

      if (pairs.length === 0) {
        // Save raw response for debugging
        const { mkdir: mk, writeFile: wf } = await import('fs/promises');
        await mk('errors', { recursive: true });
        await wf(`errors/batch-${batchNum}-raw.txt`, response, 'utf-8');
        throw new Error(`Batch ${batchNum}: no LINE/prompt pairs found. Raw response saved to errors/batch-${batchNum}-raw.txt`);
      }

      logger.success(`Parsed ${pairs.length} prompts from batch ${batchNum}`);

      allMarkdown.push(pairsToMarkdown(pairs, currentIndex));
      currentIndex += pairs.length;

      // Wait for generation to finish before sending NEXT — detects stop button
      if (b < totalBatches - 1) {
        await gemini.waitForGenerationDone();
        logger.status('Sending NEXT...');
      }
    }

    logger.blank();
    logger.success(`Generated ${currentIndex - 1} total prompts across ${totalBatches} batches.`);

    return allMarkdown.join('\n\n');
  } finally {
    await gemini.close();
  }
}

/**
 * Dry run: parse the script and show batches without calling Gemini.
 */
export async function dryRun(script: string, config: GeminiConfig, logger: Logger): Promise<void> {
  const batches = splitIntoBatches(script, config.batchSize);

  logger.header('Dry Run — Gemini Prompt Generation');
  logger.config('Total batches', String(batches.length));
  logger.config('Batch size', `${config.batchSize} lines`);
  logger.config('Model', config.model);
  logger.blank();

  batches.forEach((batch, i) => {
    logger.section(`Batch ${i + 1}/${batches.length}`);
    batch.forEach((line, j) => {
      const preview = line.length > 80 ? line.slice(0, 80) + '...' : line;
      console.log(`  ${j + 1}. ${preview}`);
    });
  });

  logger.blank();
  logger.status(`No browser will be opened (dry run mode).`);
  logger.status(`${batches.length} batches × ${config.batchSize} lines = ${batches.length * config.batchSize} max prompts.`);
}