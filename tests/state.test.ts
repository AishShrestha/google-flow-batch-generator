// tests/state.test.ts - State manager tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../src/state.js';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';

const TEST_STATE_FILE = 'test-state.json';

afterEach(async () => {
  if (existsSync(TEST_STATE_FILE)) {
    await rm(TEST_STATE_FILE);
  }
});

describe('StateManager', () => {
  it('starts with empty state', () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    expect(sm.getCompleted()).toEqual([]);
    expect(sm.getFailed()).toEqual([]);
    expect(sm.getLastProcessed()).toBe(0);
  });

  it('marks prompts as completed', () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    sm.markCompleted(1);
    sm.markCompleted(2);
    sm.markCompleted(3);
    expect(sm.getCompleted()).toEqual([1, 2, 3]);
  });

  it('detects completed prompts for skipping', () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    sm.markCompleted(1);
    sm.markCompleted(2);
    sm.markCompleted(3);
    expect(sm.isCompleted(2)).toBe(true);
    expect(sm.isCompleted(4)).toBe(false);
  });

  it('marks prompts as failed', () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    sm.markFailed(5);
    sm.markFailed(10);
    expect(sm.getFailed()).toEqual([5, 10]);
  });

  it('removes from failed when marked completed', () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    sm.markFailed(3);
    sm.markCompleted(3);
    expect(sm.getFailed()).toEqual([]);
    expect(sm.getCompleted()).toEqual([3]);
  });

  it('saves and loads state from file', async () => {
    const sm1 = new StateManager('test.md', TEST_STATE_FILE);
    sm1.markCompleted(1);
    sm1.markCompleted(2);
    sm1.markCompleted(3);
    sm1.markFailed(5);
    await sm1.save();

    const sm2 = new StateManager('test.md', TEST_STATE_FILE);
    await sm2.load();

    expect(sm2.getCompleted()).toEqual([1, 2, 3]);
    expect(sm2.getFailed()).toEqual([5]);
    expect(sm2.getLastProcessed()).toBe(5);
  });

  it('state survives application restart', async () => {
    const sm1 = new StateManager('test.md', TEST_STATE_FILE);
    sm1.markCompleted(1);
    sm1.markCompleted(2);
    sm1.markCompleted(3);
    sm1.markCompleted(4);
    await sm1.save();

    // Simulate restart
    const sm2 = new StateManager('test.md', TEST_STATE_FILE);
    await sm2.load();

    // Prompts 1-4 should be skipped
    expect(sm2.isCompleted(1)).toBe(true);
    expect(sm2.isCompleted(2)).toBe(true);
    expect(sm2.isCompleted(3)).toBe(true);
    expect(sm2.isCompleted(4)).toBe(true);
    expect(sm2.isCompleted(5)).toBe(false);
  });

  it('does not load state from different input file', async () => {
    const sm1 = new StateManager('test.md', TEST_STATE_FILE);
    sm1.markCompleted(1);
    await sm1.save();

    const sm2 = new StateManager('other.md', TEST_STATE_FILE);
    await sm2.load();

    expect(sm2.getCompleted()).toEqual([]);
  });

  it('resets state', async () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    sm.markCompleted(1);
    sm.markCompleted(2);
    sm.markFailed(3);
    await sm.save();

    await sm.reset();

    expect(sm.getCompleted()).toEqual([]);
    expect(sm.getFailed()).toEqual([]);
    expect(sm.getLastProcessed()).toBe(0);
  });

  it('does not duplicate completed entries', () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    sm.markCompleted(1);
    sm.markCompleted(1);
    sm.markCompleted(1);
    expect(sm.getCompleted()).toEqual([1]);
  });

  it('tracks lastProcessed correctly', () => {
    const sm = new StateManager('test.md', TEST_STATE_FILE);
    sm.markCompleted(5);
    sm.markCompleted(10);
    sm.markFailed(3);
    expect(sm.getLastProcessed()).toBe(10);
  });
});