// src/logger.ts - Terminal logging with progress display

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';

export class Logger {
  private total: number = 0;
  private completed: number = 0;
  private failed: number = 0;

  setTotal(total: number) {
    this.total = total;
  }

  header(title: string) {
    console.log(`\n${BOLD}${CYAN}${title}${RESET}`);
    console.log(`${DIM}────────────────────────────────────────${RESET}\n`);
  }

  info(msg: string) {
    console.log(`${DIM}${msg}${RESET}`);
  }

  found(count: number, prompts: string[] = []) {
    console.log(`${BOLD}Found ${count} image prompts.${RESET}\n`);
    if (prompts.length > 0 && prompts.length <= 30) {
      prompts.forEach((p, i) => {
        const preview = p.length > 80 ? p.slice(0, 80) + '...' : p;
        console.log(`  ${i + 1}. ${preview}`);
      });
      console.log();
    }
  }

  config(label: string, value: string) {
    console.log(`${DIM}${label}:${RESET} ${value}`);
  }

  section(title: string) {
    console.log(`\n${BOLD}════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}${title}${RESET}`);
    console.log(`${BOLD}════════════════════════════════════════${RESET}\n`);
  }

  generating(current: number, total: number, prompt: string) {
    const preview = prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt;
    console.log(`\n${BOLD}Generating image ${current} / ${total}${RESET}`);
    console.log(`${DIM}Prompt:${RESET} ${preview}\n`);
  }

  status(msg: string) {
    console.log(`${DIM}${msg}${RESET}`);
  }

  retry(attempt: number, max: number) {
    console.log(`${YELLOW}  Attempt ${attempt}/${max}${RESET}`);
  }

  success(msg: string) {
    console.log(`${GREEN}✓ ${msg}${RESET}`);
    this.completed++;
  }

  error(msg: string) {
    console.error(`${RED}✗ ${msg}${RESET}`);
  }

  warn(msg: string) {
    console.log(`${YELLOW}⚠ ${msg}${RESET}`);
  }

  skip(index: number) {
    console.log(`${YELLOW}Skipping #${index} — already completed${RESET}`);
  }

  waiting(ms: number) {
    console.log(`${DIM}Waiting ${ms / 1000}s before next prompt...${RESET}`);
  }

  manualIntervention(promptNum: number) {
    console.log(`\n${YELLOW}${BOLD}Automation requires manual intervention for prompt #${promptNum}.${RESET}`);
    console.log(`${YELLOW}Please fix the Google Flow UI state in the browser.${RESET}`);
    console.log(`${YELLOW}Press ENTER when ready to continue.${RESET}\n`);
  }

  loginRequired() {
    console.log(`\n${BOLD}────────────────────────────────────────${RESET}`);
    console.log(`${BOLD}Google authentication is required.${RESET}`);
    console.log(`${DIM}Please log into Google Flow in the browser.${RESET}`);
    console.log(`${DIM}When you have finished logging in, return to this terminal${RESET}`);
    console.log(`${DIM}and press ENTER.${RESET}`);
    console.log(`${BOLD}────────────────────────────────────────${RESET}\n`);
  }

  loginDetected() {
    console.log(`${GREEN}Login detected.${RESET}\n`);
  }

  startingBatch() {
    console.log(`${BOLD}Starting batch...${RESET}\n`);
  }

  batchComplete(total: number, successful: number, failed: number, skipped: number, failedList: number[]) {
    console.log(`\n${BOLD}════════════════════════════════════════${RESET}`);
    console.log(`${BOLD}BATCH COMPLETE${RESET}`);
    console.log(`${BOLD}════════════════════════════════════════${RESET}\n`);

    console.log(`Total prompts: ${total}`);
    console.log(`Successful:    ${GREEN}${successful}${RESET}`);
    console.log(`Failed:        ${RED}${failed}${RESET}`);
    console.log(`Skipped:       ${YELLOW}${skipped}${RESET}`);

    if (failedList.length > 0) {
      console.log(`\n${RED}Failed prompts:${RESET}`);
      console.log(failedList.join(', '));
    }

    console.log(`\n${DIM}Output: ./output${RESET}\n`);
  }

  progress(current: number, total: number, status: string) {
    const pct = Math.round((current / total) * 100);
    const barLen = 20;
    const filled = Math.round((current / total) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

    process.stdout.write(`\r${DIM}[${bar}] ${pct}% — ${current}/${total} ${status}${RESET}    `);
  }

  clearProgress() {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }

  blank() {
    console.log();
  }
}