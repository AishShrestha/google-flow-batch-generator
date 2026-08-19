// src/flow.ts - Google Flow browser automation via Playwright

import { chromium, BrowserContext, Page, ElementHandle } from 'playwright';
import { GeneratorConfig, ImageGenerator } from './types.js';
import { SELECTORS } from './selectors.js';
import {
  savePromptText,
  saveDownload,
  saveImageFromUrl,
  saveScreenshot,
  saveCanvasFromFrame,
  saveSvgFromFrame,
  verifyFile,
} from './downloader.js';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { Logger } from './logger.js';

export class GoogleFlowAutomation implements ImageGenerator {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: GeneratorConfig;
  private logger: Logger;

  constructor(config: GeneratorConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    this.logger.status('Starting browser...');

    this.context = await chromium.launchPersistentContext(this.config.browserProfileDir, {
      headless: this.config.headless,
      viewport: { width: this.config.viewportWidth, height: this.config.viewportHeight },
      channel: 'chrome', // Use installed Google Chrome
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    // Disable file download dialogs (auto-save)
    this.context.on('page', () => {});

    this.page = await this.context.newPage();
    await this.page.setDefaultTimeout(this.config.generationTimeoutMs);

    this.logger.success('Browser started.');
  }

  async ensureLoggedIn(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    this.logger.status(`Navigating to ${this.config.flowUrl}...`);
    await this.page.goto(this.config.flowUrl, { waitUntil: 'networkidle' });

    // Give time for redirects to settle
    await this.page.waitForTimeout(2000);

    // Check if we're on a Google login page
    const currentUrl = this.page.url();
    const isLoginPage = this.page.url().includes('accounts.google.com') ||
      await this.page.locator('input[type="email"]').count() > 0;

    if (isLoginPage) {
      this.logger.loginRequired();

      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      await new Promise<void>((resolve) => {
        rl.question('', () => {
          rl.close();
          resolve();
        });
      });

      // Re-check after login
      await this.page.goto(this.config.flowUrl, { waitUntil: 'networkidle' });
      await this.page.waitForTimeout(2000);

      const stillOnLogin = this.page.url().includes('accounts.google.com');
      if (stillOnLogin) {
        throw new Error('Still on login page after user confirmation. Please ensure you are logged in.');
      }
    }

    this.logger.loginDetected();
  }

  async openImageGeneration(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    // Wait for the page to be ready
    await this.page.waitForLoadState('networkidle');

    // Google Flow lazy-loads the prompt textarea; search across all frames.
    this.logger.status('Waiting for prompt input to appear...');
    const inputFound = await this.findPromptInputElement();

    if (!inputFound) {
      this.logger.warn('Could not immediately find image generation interface.');
      this.logger.status('Please navigate to the image generation page in the browser.');
      this.logger.status('Press ENTER when ready.');

      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      await new Promise<void>((resolve) => {
        rl.question('', () => {
          rl.close();
          resolve();
        });
      });
    }

    const confirmed = await this.findPromptInputElement();
    if (!confirmed) {
      throw new Error('Could not locate the prompt input on Google Flow. Run `npm run inspect` to debug selectors.');
    }

    this.logger.success('Image generation interface detected');
  }

  private async findPromptInput(): Promise<boolean> {
    if (!this.page) return false;

    // Log frame count — Google Flow may render the tool inside an iframe.
    const frameCount = this.page.frames().length;
    this.logger.status(`Page has ${frameCount} frame(s)`);

    // Search every frame for the textarea.
    for (const frame of this.page.frames()) {
      try {
        const count = await frame.evaluate((selector) => {
          return document.querySelectorAll(selector).length;
        }, SELECTORS.promptInput);

        if (count > 0) {
          this.logger.status(`Found prompt input in frame (${frame.url() || 'main'})`);
          return true;
        }
      } catch {
        // Some frames may not allow evaluation (e.g., about:blank).
      }
    }

    // Fallback: find any textarea with a placeholder mentioning action/description.
    for (const frame of this.page.frames()) {
      try {
        const found = await frame.evaluate(() => {
          const textareas = Array.from(document.querySelectorAll('textarea'));
          const match = textareas.find((t) => {
            const ph = (t.getAttribute('placeholder') || '').toLowerCase();
            return ph.includes('describe') || ph.includes('action') || ph.includes('prompt');
          });
          return { found: !!match, placeholder: match?.getAttribute('placeholder') || null };
        });

        if (found.found) {
          this.logger.status(`Fallback found textarea with placeholder: ${found.placeholder}`);
          return true;
        }
      } catch {
        // ignore
      }
    }

    this.logger.warn('No prompt input found in any frame or fallback search');
    return false;
  }

  async submitPrompt(prompt: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    this.logger.status('Submitting prompt...');

    // Google Flow renders the tool UI inside an iframe, so search all frames.
    const input = await this.findPromptInputElement();
    if (!input) {
      throw new Error('Could not locate prompt input textarea in any frame.');
    }

    this.logger.status('Prompt input located in frame');

    // Focus and fill the textarea through its element handle.
    await input.focus();
    await input.fill(prompt);

    // Verify the input contains the expected text
    const actualText = await input.evaluate((el) => {
      if (el instanceof HTMLTextAreaElement) return el.value;
      return '';
    });

    if (!actualText.includes(prompt.slice(0, 50))) {
      throw new Error('Prompt text was not properly entered into the input field.');
    }

    this.logger.status('Prompt entered. Clicking generate...');

    const generateBtn = await this.findGenerateButtonElement();
    if (!generateBtn) {
      throw new Error('Could not locate generate button in any frame.');
    }

    await generateBtn.click();
  }

  /**
   * Search every frame for the prompt textarea by placeholder text.
   */
  private async findPromptInputElement(): Promise<ElementHandle<HTMLTextAreaElement> | null> {
    if (!this.page) return null;

    const frames = this.page.frames();
    this.logger.status(`Searching ${frames.length} frame(s) for prompt textarea...`);

    for (const frame of frames) {
      try {
        const handle = await frame.evaluateHandle(() => {
          const textareas = Array.from(document.querySelectorAll('textarea'));
          const match = textareas.find((el) => {
            const ph = (el.getAttribute('placeholder') || '').toLowerCase();
            return ph.includes('describe') && ph.includes('action');
          });
          return match || null;
        });

        const element = handle.asElement() as ElementHandle<HTMLTextAreaElement> | null;
        if (element) {
          this.logger.status(`Found prompt textarea in frame: ${frame.url() || 'main'}`);
          return element;
        }
      } catch (err) {
        this.logger.warn(`Frame search failed: ${(err as Error).message}`);
      }
    }

    return null;
  }

  /**
   * Search every frame for the generate button by text content.
   */
  private async findGenerateButtonElement(): Promise<ElementHandle<HTMLButtonElement> | null> {
    if (!this.page) return null;

    const frames = this.page.frames();

    for (const frame of frames) {
      try {
        const handle = await frame.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const match = buttons.find((el) =>
            (el.textContent || '').toLowerCase().includes('generate')
          );
          return match || null;
        });

        const element = handle.asElement() as ElementHandle<HTMLButtonElement> | null;
        if (element) {
          this.logger.status(`Found generate button in frame: ${frame.url() || 'main'}`);
          return element;
        }
      } catch {
        // ignore frames that cannot be evaluated
      }
    }

    return null;
  }

  async waitForGeneration(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    const timeout = this.config.generationTimeoutMs;
    const pollIntervalMs = 1000;
    const startTime = Date.now();

    this.logger.status('Waiting for generation to start...');

    // First, wait briefly for a loading indicator to appear.
    let generationStarted = false;
    const startWaitDeadline = Date.now() + 10000;
    while (Date.now() < startWaitDeadline) {
      const state = await this.getGenerationState();
      if (state.isLoading || state.hasResult) {
        generationStarted = true;
        break;
      }
      await this.page.waitForTimeout(pollIntervalMs);
    }

    if (!generationStarted) {
      this.logger.warn('No loading indicator detected; assuming generation started.');
    }

    this.logger.status('Waiting for generation to complete...');

    // Poll until generation finishes and the generate button is ready again.
    while (Date.now() - startTime < timeout) {
      const state = await this.getGenerationState();

      if (state.hasError) {
        throw new Error(`Google Flow error: ${state.errorText || 'Unknown error'}`);
      }

      // Generation is complete when there is a result and the generate button is ready.
      if (state.hasResult && state.isGenerateReady) {
        this.logger.status('Generation complete.');
        return;
      }

      // Some tools show the result but keep the button disabled for a moment.
      if (!state.isLoading && state.hasResult) {
        this.logger.status('Result visible, waiting for generate button to become ready...');
        const buttonReady = await this.waitForGenerateButtonReady(5000);
        if (buttonReady) {
          return;
        }
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    throw new Error(`Generation timed out after ${timeout / 1000} seconds.`);
  }

  /**
   * Gather the current generation state by scanning all frames.
   */
  private async getGenerationState(): Promise<{
    isLoading: boolean;
    hasResult: boolean;
    hasError: boolean;
    errorText: string | null;
    isGenerateReady: boolean;
  }> {
    if (!this.page) {
      return {
        isLoading: false,
        hasResult: false,
        hasError: false,
        errorText: null,
        isGenerateReady: false,
      };
    }

    const frames = this.page.frames();
    let isLoading = false;
    let hasResult = false;
    let hasError = false;
    let errorText: string | null = null;
    let isGenerateReady = false;

    for (const frame of frames) {
      try {
        const frameState = await frame.evaluate(() => {
          const text = document.body ? (document.body.textContent || '').toLowerCase() : '';

          // B-2 Illustrator shows "Illustrating..." on the button and "ASSEMBLING ILLUSTRATION..." in the preview.
          const loading =
            text.includes('illustrating') ||
            text.includes('assembling illustration') ||
            text.includes('generating');

          // Error messages
          const errorElements = Array.from(
            document.querySelectorAll('[role="alert"], .error-message, [data-testid*="error"]')
          );
          const firstError = errorElements.find((el) => el.textContent?.trim());
          const error = firstError ? firstError.textContent?.trim() || null : null;

          // Result detection: canvas, svg, image, or a populated preview container.
          const preview = document.querySelector('[class*="illustration" i], [class*="result" i]');
          const canvas = document.querySelector('canvas');
          const svg = document.querySelector('svg');
          const img = document.querySelector('img[src*="blob:"], img[src^="data:"]');
          const hasAnyResult = !!(preview || canvas || svg || img);

          // Generate button ready: visible button with "generate" text and no "illustrating" text.
          const buttons = Array.from(document.querySelectorAll('button'));
          const generateBtn = buttons.find((btn) => {
            const btnText = (btn.textContent || '').toLowerCase();
            return btnText.includes('generate') && !btnText.includes('illustrating');
          });

          return {
            isLoading: loading,
            hasResult: hasAnyResult,
            hasError: !!error,
            errorText: error,
            isGenerateReady: !!generateBtn && !generateBtn.disabled,
          };
        });

        if (frameState.isLoading) isLoading = true;
        if (frameState.hasResult) hasResult = true;
        if (frameState.hasError) {
          hasError = true;
          errorText = frameState.errorText;
        }
        if (frameState.isGenerateReady) isGenerateReady = true;
      } catch {
        // ignore frames that cannot be evaluated
      }
    }

    return { isLoading, hasResult, hasError, errorText, isGenerateReady };
  }

  /**
   * Wait up to the given timeout for the generate button to become ready again.
   */
  private async waitForGenerateButtonReady(timeoutMs: number): Promise<boolean> {
    if (!this.page) return false;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of this.page.frames()) {
        try {
          const ready = await frame.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn = buttons.find((b) => {
              const t = (b.textContent || '').toLowerCase();
              return t.includes('generate') && !t.includes('illustrating');
            });
            return !!btn && !btn.disabled;
          });
          if (ready) return true;
        } catch {
          // ignore
        }
      }
      await this.page.waitForTimeout(500);
    }

    return false;
  }

  async downloadGeneratedImages(outputDir: string, promptIndex: number): Promise<string[]> {
    if (!this.page) throw new Error('Browser not initialized');

    const savedPaths: string[] = [];

    // Strategy 1: Try to find and click download buttons (main frame only)
    const downloadButtons = this.page.locator(SELECTORS.downloadButton);
    const downloadCount = await downloadButtons.count();

    if (downloadCount > 0) {
      const maxImages = Math.min(downloadCount, this.config.maxImagesPerPrompt);

      for (let i = 0; i < maxImages; i++) {
        try {
          const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
          await downloadButtons.nth(i).click();
          const download = await downloadPromise;
          const path = await saveDownload(download, outputDir, promptIndex, i);
          savedPaths.push(path);
        } catch (err) {
          // Download might have failed for this image
          this.logger.warn(`Download ${i + 1} failed: ${(err as Error).message}`);
        }
      }
    }

    // Strategy 2: Extract canvas / svg / image from whichever frame rendered it.
    if (savedPaths.length === 0) {
      for (const frame of this.page.frames()) {
        try {
          const frameHasResult = await frame.evaluate(() => {
            return !!(
              document.querySelector('canvas') ||
              document.querySelector('svg') ||
              document.querySelector('img[src*="blob:"], img[src^="data:"]')
            );
          });

          if (!frameHasResult) continue;

          this.logger.status(`Found generated result in frame: ${frame.url() || 'main'}`);

          // Prefer canvas PNG export
          const canvasPath = await saveCanvasFromFrame(frame, outputDir, promptIndex, 0);
          if (canvasPath) {
            savedPaths.push(canvasPath);
            break;
          }

          // Fallback to SVG serialization
          const svgPath = await saveSvgFromFrame(frame, outputDir, promptIndex, 0);
          if (svgPath) {
            savedPaths.push(svgPath);
            break;
          }

          // Fallback to image src
          const src = await frame.evaluate(() => {
            const img = document.querySelector('img[src*="blob:"], img[src^="data:"]');
            return img?.getAttribute('src') || null;
          });
          if (src && this.page) {
            const path = await saveImageFromUrl(this.page, src, outputDir, promptIndex, 0);
            savedPaths.push(path);
            break;
          }
        } catch (err) {
          this.logger.warn(`Frame extraction failed: ${(err as Error).message}`);
        }
      }
    }

    // Strategy 3: Screenshot fallback of the main preview area
    if (savedPaths.length === 0) {
      this.logger.warn('No canvas/svg/image found. Using screenshot fallback.');
      try {
        const path = await saveScreenshot(
          this.page,
          SELECTORS.generatedImage,
          outputDir,
          promptIndex,
          0
        );
        savedPaths.push(path);
      } catch (err) {
        throw new Error(`All download strategies failed: ${(err as Error).message}`);
      }
    }

    // Verify files exist
    const verifiedPaths = savedPaths.filter((p) => verifyFile(p));
    if (verifiedPaths.length === 0) {
      throw new Error('No image files were saved successfully.');
    }

    return verifiedPaths;
  }

  async saveErrorDiagnostics(index: number, prompt: string, error: Error): Promise<void> {
    if (!this.page) return;

    const errorsDir = 'errors';
    await mkdir(errorsDir, { recursive: true });

    const prefix = String(index).padStart(3, '0');

    // Screenshot
    try {
      await this.page.screenshot({ path: join(errorsDir, `${prefix}-error.png`), fullPage: false });
    } catch {}

    // HTML snapshot
    try {
      const html = await this.page.content();
      await writeFile(join(errorsDir, `${prefix}-error.html`), html, 'utf-8');
    } catch {}

    // Error details
    const errorText = [
      `Prompt number: ${index}`,
      `Prompt text: ${prompt}`,
      `Error message: ${error.message}`,
      `Timestamp: ${new Date().toISOString()}`,
      `Current URL: ${this.page.url()}`,
      `Stack trace: ${error.stack || 'N/A'}`,
    ].join('\n');

    await writeFile(join(errorsDir, `${prefix}-error.txt`), errorText, 'utf-8');
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