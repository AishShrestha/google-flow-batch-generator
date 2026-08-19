// src/selectors.ts - All Google Flow UI selectors in one place
// If Google Flow's UI changes, update selectors here only.

export const SELECTORS = {
  // Prompt input area — left sidebar textarea for describing the action
  promptInput: 'textarea[placeholder*="Describe the action"]',

  // Generate button — text-based match (Google Flow shows "Generate B-2" etc.)
  generateButton: 'button:has-text("Generate"), button:has-text("Generate B-2")',

  // Loading/generation indicator — covers B-2 Illustrator "Illustrating..." / "ASSEMBLING ILLUSTRATION..."
  loadingIndicator:
    'button:has-text("Illustrating"), button:has-text("Generating"), :has-text("ASSEMBLING ILLUSTRATION"), [role="progressbar"], [aria-busy="true"]',

  // Generated image/illustration container — main preview area
  // B-2 Illustrator renders into a canvas/svg/img inside the right preview pane.
  generatedImage:
    'canvas, svg, img[src*="blob:"], img[src^="data:"], [class*="illustration" i], [class*="result" i], [data-testid*="result"]',

  // Download button
  downloadButton:
    'button:has-text("Download"), button[aria-label*="download" i], a[download]',

  // Multiple result images / canvases / svgs (if Google Flow shows candidates)
  resultImages:
    'canvas, svg, img[src*="blob:"], img[src^="data:"], [class*="illustration" i], [class*="result" i], [data-testid*="result"]',

  // Error messages
  errorMessage: '[role="alert"], .error-message, [data-testid*="error"]',

  // Body (for detecting page load)
  body: 'body',
} as const;

export type SelectorKey = keyof typeof SELECTORS;
