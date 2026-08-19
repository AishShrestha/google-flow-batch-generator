// src/types.ts - Shared type definitions

export interface ImagePrompt {
  index: number;
  scriptLine?: string;
  prompt: string;
}

export interface BatchState {
  inputFile: string;
  completed: number[];
  failed: number[];
  lastProcessed: number;
}

export interface CLIArgs {
  inputFile: string;
  start: number;
  limit: number | null;
  dryRun: boolean;
  force: boolean;
  manual: boolean;
  inspect: boolean;
  delay: number | null;
}

export interface GeneratorConfig {
  flowUrl: string;
  browserProfileDir: string;
  outputDir: string;
  generationTimeoutMs: number;
  maxRetries: number;
  delayBetweenPromptsMs: number;
  headless: boolean;
  maxImagesPerPrompt: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface GeminiConfig {
  url: string;
  profileDir: string;
  model: string;
  fallbackModel: string;
  batchSize: number;
  timeoutMs: number;
  headless: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface PromptGenArgs {
  inputFile: string;
  outputFile: string;
  dryRun: boolean;
  model: string | null;
  batchSize: number | null;
  inspect: boolean;
}

export interface ImageGenerator {
  initialize(): Promise<void>;
  ensureLoggedIn(): Promise<void>;
  submitPrompt(prompt: string): Promise<void>;
  waitForGeneration(): Promise<void>;
  downloadGeneratedImages(outputDir: string, promptIndex: number): Promise<string[]>;
  close(): Promise<void>;
}

export interface GenerationResult {
  success: boolean;
  imagePaths: string[];
  error?: string;
}