// src/state.ts - Progress tracking and resumability

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { BatchState } from './types.js';

const STATE_FILE = 'state.json';

export class StateManager {
  private state: BatchState;
  private stateFile: string;

  constructor(inputFile: string, stateFile: string = STATE_FILE) {
    this.stateFile = stateFile;
    this.state = {
      inputFile,
      completed: [],
      failed: [],
      lastProcessed: 0,
    };
  }

  async load(): Promise<BatchState> {
    if (!existsSync(this.stateFile)) {
      return this.state;
    }

    try {
      const raw = await readFile(this.stateFile, 'utf-8');
      const loaded = JSON.parse(raw) as BatchState;

      // Only reuse state if it's for the same input file
      if (loaded.inputFile === this.state.inputFile) {
        this.state = loaded;
      }
      return this.state;
    } catch {
      return this.state;
    }
  }

  async save(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2);
    await writeFile(this.stateFile, data, 'utf-8');
  }

  isCompleted(index: number): boolean {
    return this.state.completed.includes(index);
  }

  markCompleted(index: number): void {
    if (!this.state.completed.includes(index)) {
      this.state.completed.push(index);
    }
    // Remove from failed if it was previously failed
    this.state.failed = this.state.failed.filter((i) => i !== index);
    this.state.lastProcessed = Math.max(this.state.lastProcessed, index);
  }

  markFailed(index: number): void {
    if (!this.state.failed.includes(index)) {
      this.state.failed.push(index);
    }
    this.state.lastProcessed = Math.max(this.state.lastProcessed, index);
  }

  getCompleted(): number[] {
    return [...this.state.completed].sort((a, b) => a - b);
  }

  getFailed(): number[] {
    return [...this.state.failed].sort((a, b) => a - b);
  }

  getLastProcessed(): number {
    return this.state.lastProcessed;
  }

  async reset(): Promise<void> {
    this.state = {
      inputFile: this.state.inputFile,
      completed: [],
      failed: [],
      lastProcessed: 0,
    };
    await this.save();
  }

  getState(): BatchState {
    return { ...this.state };
  }
}