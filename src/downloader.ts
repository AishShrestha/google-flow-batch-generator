// src/downloader.ts - Image download and output management

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { Page, Download, Frame } from 'playwright';

/**
 * Pad a number with leading zeros to 3 digits.
 */
export function padNumber(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * Save prompt text to a file.
 */
export async function savePromptText(outputDir: string, index: number, prompt: string): Promise<void> {
  const dir = join(outputDir, padNumber(index));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${padNumber(index)}-prompt.txt`), prompt, 'utf-8');
}

/**
 * Save a download to the output directory.
 */
export async function saveDownload(
  download: Download,
  outputDir: string,
  index: number,
  imageNum: number
): Promise<string> {
  const dir = join(outputDir, padNumber(index));
  await mkdir(dir, { recursive: true });

  // Get the suggested filename and extension
  const suggested = download.suggestedFilename();
  const ext = suggested.match(/\.(\w+)$/)?.[1] || 'png';

  const filename = imageNum === 0
    ? `${padNumber(index)}.${ext}`
    : `${padNumber(index)}-${String(imageNum).padStart(2, '0')}.${ext}`;
  const filepath = join(dir, filename);

  await download.saveAs(filepath);
  return filepath;
}

/**
 * Save an image from a URL/blob URL by fetching it via the page.
 */
export async function saveImageFromUrl(
  page: Page,
  imageUrl: string,
  outputDir: string,
  index: number,
  imageNum: number
): Promise<string> {
  const dir = join(outputDir, padNumber(index));
  await mkdir(dir, { recursive: true });

  // For blob: URLs, we need to fetch via page.evaluate
  if (imageUrl.startsWith('blob:')) {
    const base64 = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, imageUrl);

    const base64Data = base64.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    const filename = imageNum === 0
      ? `${padNumber(index)}.png`
      : `${padNumber(index)}-${String(imageNum).padStart(2, '0')}.png`;
    const filepath = join(dir, filename);
    await writeFile(filepath, buffer);
    return filepath;
  }

  // For regular URLs, use page.goto and screenshot or fetch
  const filename = imageNum === 0
    ? `${padNumber(index)}.png`
    : `${padNumber(index)}-${String(imageNum).padStart(2, '0')}.png`;
  const filepath = join(dir, filename);

  // Fetch the image data via the page context
  const base64 = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, imageUrl);

  const buffer = Buffer.from(base64.split(',')[1], 'base64');
  await writeFile(filepath, buffer);
  return filepath;
}

/**
 * Screenshot fallback — capture the generated image element from the page.
 */
export async function saveScreenshot(
  page: Page,
  selector: string,
  outputDir: string,
  index: number,
  imageNum: number
): Promise<string> {
  const dir = join(outputDir, padNumber(index));
  await mkdir(dir, { recursive: true });

  const filename = imageNum === 0
    ? `${padNumber(index)}.png`
    : `${padNumber(index)}-${String(imageNum).padStart(2, '0')}.png`;
  const filepath = join(dir, filename);

  const element = page.locator(selector).first();
  await element.screenshot({ path: filepath });
  return filepath;
}

/**
 * Save a <canvas> element from a frame as a PNG image.
 */
export async function saveCanvasFromFrame(
  frame: Frame,
  outputDir: string,
  index: number,
  imageNum: number
): Promise<string | null> {
  const dir = join(outputDir, padNumber(index));
  await mkdir(dir, { recursive: true });

  const filename = imageNum === 0
    ? `${padNumber(index)}.png`
    : `${padNumber(index)}-${String(imageNum).padStart(2, '0')}.png`;
  const filepath = join(dir, filename);

  const dataUrl = await frame.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  });

  if (!dataUrl) return null;

  const base64Data = dataUrl.split(',')[1];
  await writeFile(filepath, Buffer.from(base64Data, 'base64'));
  return filepath;
}

/**
 * Save an <svg> element from a frame as an SVG file.
 */
export async function saveSvgFromFrame(
  frame: Frame,
  outputDir: string,
  index: number,
  imageNum: number
): Promise<string | null> {
  const dir = join(outputDir, padNumber(index));
  await mkdir(dir, { recursive: true });

  const filename = imageNum === 0
    ? `${padNumber(index)}.svg`
    : `${padNumber(index)}-${String(imageNum).padStart(2, '0')}.svg`;
  const filepath = join(dir, filename);

  const svgText = await frame.evaluate(() => {
    const svg = document.querySelector('svg');
    if (!svg) return null;
    return new XMLSerializer().serializeToString(svg);
  });

  if (!svgText) return null;

  await writeFile(filepath, svgText, 'utf-8');
  return filepath;
}

/**
 * Verify a file exists.
 */
export function verifyFile(filepath: string): boolean {
  return existsSync(filepath);
}

/**
 * Compute SHA-256 hash of a file. Used for duplicate detection.
 * Returns null if file doesn't exist or can't be read.
 */
export async function hashFile(filepath: string): Promise<string | null> {
  try {
    if (!existsSync(filepath)) return null;
    const data = await readFile(filepath);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Check if the newly saved image is identical to the previous prompt's image.
 * Compares the first image of each prompt (NNN.png or NNN-01.png).
 */
export async function isDuplicateImage(
  outputDir: string,
  currentIndex: number
): Promise<boolean> {
  if (currentIndex <= 1) return false;

  const padded = padNumber(currentIndex);
  const prevPadded = padNumber(currentIndex - 1);

  // Per-prompt folders: output/NNN/NNN.png, output/NNN/NNN-01.png
  const currentCandidates = [
    join(outputDir, padded, `${padded}.png`),
    join(outputDir, padded, `${padded}-01.png`),
  ];

  const prevCandidates = [
    join(outputDir, prevPadded, `${prevPadded}.png`),
    join(outputDir, prevPadded, `${prevPadded}-01.png`),
  ];

  for (const currPath of currentCandidates) {
    const currHash = await hashFile(currPath);
    if (!currHash) continue;

    for (const prevPath of prevCandidates) {
      const prevHash = await hashFile(prevPath);
      if (prevHash && prevHash === currHash) {
        return true;
      }
    }
  }

  return false;
}