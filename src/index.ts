// src/index.ts - CLI entry point

import 'dotenv/config';
import { parseArgs } from 'util';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { parseFile } from './parser.js';
import { StateManager } from './state.js';
import { GoogleFlowAutomation } from './flow.js';
import { Logger } from './logger.js';
import { CLIArgs, GeneratorConfig, ImagePrompt } from './types.js';
import { savePromptText } from './downloader.js';
import { mkdir } from 'fs/promises';

const logger = new Logger();

function printUsage(): void {
  console.log(`
Usage: npm run generate -- <prompts.md> [options]

Options:
  --start <n>      Start from prompt number n (1-indexed)
  --limit <n>      Only process n prompts
  --dry-run        Parse and display prompts without opening browser
  --force          Regenerate already-completed prompts
  --manual         Enable manual intervention mode
  --delay <ms>     Override delay between prompts
  --inspect        Launch browser for UI inspection/debugging
  --help, -h       Show this help

Examples:
  npm run generate -- prompts.md
  npm run generate -- prompts.md --dry-run
  npm run generate -- prompts.md --start 20
  npm run generate -- prompts.md --start 20 --limit 50
  npm run generate -- prompts.md --force
  npm run generate -- prompts.md --manual
  npm run inspect
`);
}

function parseCLI(): CLIArgs | null {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      start: { type: 'string', default: '1' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      manual: { type: 'boolean', default: false },
      delay: { type: 'string' },
      inspect: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      h: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || values.h) {
    printUsage();
    return null;
  }

  // For inspect mode, no file is required
  if (values.inspect && positionals.length === 0) {
    return {
      inputFile: '',
      start: 1,
      limit: null,
      dryRun: false,
      force: false,
      manual: false,
      inspect: true,
      delay: null,
    };
  }

  if (positionals.length === 0) {
    console.error('Error: No input file specified.\n');
    printUsage();
    return null;
  }

  return {
    inputFile: positionals[0],
    start: parseInt(values.start || '1', 10),
    limit: values.limit ? parseInt(values.limit, 10) : null,
    dryRun: values['dry-run'] || false,
    force: values.force || false,
    manual: values.manual || false,
    inspect: values.inspect || false,
    delay: values.delay ? parseInt(values.delay, 10) : null,
  };
}

function loadConfig(): GeneratorConfig {
  return {
    flowUrl: process.env.FLOW_URL || 'https://labs.google/fx/tools/flow',
    browserProfileDir: process.env.BROWSER_PROFILE_DIR || '.playwright-profile',
    outputDir: process.env.OUTPUT_DIR || 'output',
    generationTimeoutMs: parseInt(process.env.GENERATION_TIMEOUT_MS || '180000', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    delayBetweenPromptsMs: parseInt(process.env.DELAY_BETWEEN_PROMPTS_MS || '3000', 10),
    headless: process.env.HEADLESS === 'true',
    maxImagesPerPrompt: parseInt(process.env.MAX_IMAGES_PER_PROMPT || '4', 10),
    viewportWidth: parseInt(process.env.VIEWPORT_WIDTH || '1280', 10),
    viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT || '800', 10),
  };
}

async function inspectMode(config: GeneratorConfig): Promise<void> {
  logger.header('Google Flow UI Inspector');
  logger.status('Launching browser with persistent profile...');
  logger.status(`Profile: ${config.browserProfileDir}`);
  logger.status(`URL: ${config.flowUrl}`);
  logger.blank();
  logger.status('The browser will open Google Flow.');
  logger.status('Navigate to the image generation interface.');
  logger.status('Use DevTools (right-click > Inspect) to identify selectors.');
  logger.status('Press Ctrl+C to close when done.');
  logger.blank();

  const flow = new GoogleFlowAutomation(config, logger);
  await flow.initialize();

  const page = flow.getPage();
  if (page) {
    await page.goto(config.flowUrl, { waitUntil: 'networkidle' });
  }

  // Keep the browser open until the user kills the process
  logger.status('Browser is open. Press Ctrl+C to exit.');

  // Wait indefinitely
  await new Promise(() => {});
}

async function dryRun(inputFile: string, prompts: ImagePrompt[]): Promise<void> {
  logger.header('Dry Run');

  const previews = prompts.map((p) => {
    const text = p.prompt.length > 80 ? p.prompt.slice(0, 80) + '...' : p.prompt;
    return text;
  });

  logger.found(prompts.length, previews);

  logger.status(`All ${prompts.length} prompts parsed successfully.`);
  logger.status('No browser will be opened (dry run mode).');
}

async function runBatch(
  args: CLIArgs,
  config: GeneratorConfig,
  prompts: ImagePrompt[]
): Promise<void> {
  const state = new StateManager(args.inputFile);
  await state.load();

  // Filter prompts based on --start and --limit
  let filtered = prompts.filter((p) => p.index >= args.start);
  if (args.limit !== null) {
    filtered = filtered.slice(0, args.limit);
  }

  const total = filtered.length;
  logger.setTotal(total);

  logger.header('Google Flow Batch Generator');
  logger.config('Input', args.inputFile);
  logger.config('Total prompts', String(total));
  logger.config('Output directory', config.outputDir);
  logger.config('Browser profile', config.browserProfileDir);
  logger.config('Force', args.force ? 'yes' : 'no');
  logger.config('Manual mode', args.manual ? 'yes' : 'no');
  logger.blank();

  const delayMs = args.delay ?? config.delayBetweenPromptsMs;

  let successful = 0;
  let failed = 0;
  let skipped = 0;
  const failedList: number[] = [];

  // Initialize browser
  const flow = new GoogleFlowAutomation(config, logger);

  try {
    await flow.initialize();
    await flow.ensureLoggedIn();
    await flow.openImageGeneration();
    logger.startingBatch();

    for (const promptData of filtered) {
      const { index, prompt } = promptData;

      // Check if already completed (unless --force)
      if (!args.force && state.isCompleted(index)) {
        logger.skip(index);
        skipped++;
        continue;
      }

      logger.generating(index, total, prompt);
      logger.progress(successful + skipped + failed, total, `Processing #${index}`);

      // Save prompt text
      await savePromptText(config.outputDir, index, prompt);

      let attempt = 0;
      let success = false;

      while (attempt < config.maxRetries && !success) {
        attempt++;
        logger.retry(attempt, config.maxRetries);

        try {
          await flow.submitPrompt(prompt);
          await flow.waitForGeneration();

          const outputDir = join(config.outputDir, String(index).padStart(3, '0'));
          await mkdir(outputDir, { recursive: true });

          const imagePaths = await flow.downloadGeneratedImages(outputDir);

          state.markCompleted(index);
          await state.save();

          for (const path of imagePaths) {
            logger.success(`Saved ${path}`);
          }

          success = true;
          successful++;
        } catch (err) {
          const error = err as Error;
          logger.error(`Attempt ${attempt} failed: ${error.message}`);

          // Save diagnostics
          await flow.saveErrorDiagnostics(index, prompt, error);

          if (attempt < config.maxRetries) {
            logger.status('Retrying...');
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            logger.error(`Prompt #${index} FAILED`);
            state.markFailed(index);
            await state.save();
            failed++;
            failedList.push(index);

            if (args.manual) {
              logger.manualIntervention(index);

              const readline = await import('readline');
              const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

              await new Promise<void>((resolve) => {
                rl.question('', () => {
                  rl.close();
                  resolve();
                });
              });

              // Try one more time after manual intervention
              try {
                await flow.submitPrompt(prompt);
                await flow.waitForGeneration();
                const outputDir = join(config.outputDir, String(index).padStart(3, '0'));
                const imagePaths = await flow.downloadGeneratedImages(outputDir);
                state.markCompleted(index);
                await state.save();
                success = true;
                successful++;
                failed--;
                failedList.pop();
              } catch (manualErr) {
                logger.error(`Manual retry also failed: ${(manualErr as Error).message}`);
              }
            }
          }
        }
      }

      // Rate limiting delay
      if (success && index < total + args.start - 1) {
        logger.waiting(delayMs);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    logger.clearProgress();
    logger.batchComplete(total, successful, failed, skipped, failedList);
  } finally {
    await flow.close();
  }
}

async function main(): Promise<void> {
  const args = parseCLI();
  if (!args) return;

  const config = loadConfig();

  // Inspect mode
  if (args.inspect) {
    await inspectMode(config);
    return;
  }

  // Verify input file
  const inputPath = resolve(args.inputFile);
  if (!existsSync(inputPath)) {
    logger.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Parse prompts
  logger.header('Google Flow Batch Generator');
  logger.status(`Parsing ${args.inputFile}...`);

  const prompts = await parseFile(inputPath);

  if (prompts.length === 0) {
    logger.error('No image prompts found in the input file.');
    logger.status('Make sure the file contains "Image Prompt:" sections.');
    process.exit(1);
  }

  logger.found(prompts.length, prompts.map((p) => p.prompt));

  // Dry run
  if (args.dryRun) {
    await dryRun(args.inputFile, prompts);
    return;
  }

  // Full batch
  await runBatch(args, config, prompts);
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});