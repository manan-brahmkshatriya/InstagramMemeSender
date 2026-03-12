/**
 * photo-quote-generator.mjs
 * Creates a 1080×1080 JPEG motivational-quote image using ffmpeg.
 *
 * Exports:
 *   createQuoteImage(quote, outputPath) → outputPath
 */

import { execFileSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";

const OUTDIR = "/tmp/reel-generator";

// ── Background colour palette (one per style) ──────────────────────────────
const BG_COLORS = [
  "0x0d1b2a",  // deep navy
  "0x1a0533",  // rich purple
  "0x0a2818",  // dark forest
  "0x1c1b18",  // warm charcoal
  "0x1a1a2e",  // midnight blue
];

// Pick a background deterministically from the quote text
function pickBg(quote) {
  const n = [...quote].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return BG_COLORS[n % BG_COLORS.length];
}

// ── Text helpers ────────────────────────────────────────────────────────────

/**
 * Wrap quote at maxChars per line (word-boundary), hard-cap at 4 lines.
 */
function wrapText(text, maxChars = 20) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > 4) {
    lines[3] = lines.slice(3).join(" ");
    return lines.slice(0, 4);
  }
  return lines;
}

/**
 * Escape special characters for ffmpeg drawtext (text='...').
 *   \  → \\   (escape backslash first)
 *   '  → '   (U+2019 curly apostrophe — visually identical, avoids breaking single-quoted arg)
 *   :  → \:   (option separator in drawtext)
 *   [  → \[   (expression delimiters)
 *   ]  → \]
 */
function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// ── Font detection ──────────────────────────────────────────────────────────
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/Library/Fonts/Arial.ttf",
  "/System/Library/Fonts/SFNSDisplay.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
];
function findFont() {
  return FONT_CANDIDATES.find(f => fs.existsSync(f)) || null;
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate a 1080×1080 JPEG with the given motivational quote.
 *
 * @param {string} quote      - The motivational quote text
 * @param {string} outputPath - Destination JPEG path
 * @returns {string}          - outputPath (for chaining)
 */
export function createQuoteImage(quote, outputPath) {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

  const W = 1080, H = 1080;
  const bgColor = pickBg(quote);
  const font    = findFont();
  const fontOpt = font ? `:fontfile='${escapeDrawtext(font)}'` : "";

  // Typography — sized for 1080px square
  const maxChars   = 20;
  const lines      = wrapText(quote, maxChars);
  const numLines   = lines.length;
  const fontSize   = Math.min(
    Math.round(H * 0.075),                          // height-based cap
    Math.round((W * 0.84) / (maxChars * 0.58)),     // width-based cap
  );
  const lineH      = Math.round(fontSize * 1.55);
  const padV       = Math.round(fontSize * 1.1);
  const padH       = Math.round(W * 0.08);

  const textBlockH = numLines * lineH - Math.round(fontSize * 0.55);
  const boxH       = textBlockH + padV * 2;
  const boxY       = Math.round((H - boxH) / 2);
  const boxX       = padH;
  const boxW       = W - padH * 2;
  const textStartY = boxY + padV;

  // Subtle top stripe (decorative)
  const stripeH  = Math.round(H * 0.006);
  const stripeFilter = `drawbox=x=0:y=0:w=${W}:h=${stripeH}:color=white@0.35:t=fill`;

  // Semi-transparent card behind text
  const cardFilter =
    `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.50:t=fill`;

  // One drawtext per line
  const textFilters = lines.map((line, i) => {
    const y = textStartY + i * lineH;
    return (
      `drawtext=text='${escapeDrawtext(line)}'` +
      `${fontOpt}:fontsize=${fontSize}:fontcolor=white` +
      `:x=(w-tw)/2:y=${y}` +
      `:shadowx=3:shadowy=3:shadowcolor=black@0.6`
    );
  });

  // Account watermark at bottom
  const watermarkFilter =
    `drawtext=text='@riseclub9'` +
    `${fontOpt}:fontsize=${Math.round(fontSize * 0.38)}:fontcolor=white@0.55` +
    `:x=(w-tw)/2:y=${H - Math.round(H * 0.06)}`;

  const vf = [stripeFilter, cardFilter, ...textFilters, watermarkFilter].join(",");

  console.log(`[photo-gen] ${numLines}-line quote, font ${fontSize}px, bg ${bgColor}`);
  console.log(`[photo-gen] "${quote}"`);

  execFileSync(ffmpegStatic, [
    "-f",       "lavfi",
    "-i",       `color=c=${bgColor}:size=${W}x${H}:rate=1`,
    "-vf",      vf,
    "-vframes", "1",
    "-update",  "1",        // write a single image (suppresses sequence-pattern warning)
    "-q:v",     "2",        // JPEG quality (2 = near-lossless)
    "-y",
    outputPath,
  ]);

  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`[photo-gen] Done → ${outputPath} (${sizeMB} MB)`);
  return outputPath;
}
