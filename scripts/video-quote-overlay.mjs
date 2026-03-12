/**
 * video-quote-overlay.mjs
 * Burns a motivational quote onto a video using ffmpeg's drawtext filter.
 *
 * Design:
 *   - Semi-transparent dark box in the vertical center of the frame
 *   - White bold text (Avenir Next), wrapping to 2-3 lines
 *   - Subtle text shadow for depth
 *   - Scales relative to video height — looks great on any resolution
 *
 * Exports:
 *   overlayQuoteOnVideo(inputPath, quote, outputPath?) → Promise<string>
 *   Returns the path to the processed video.
 */

import { execFileSync } from "child_process";
import { createRequire } from "module";
import { existsSync } from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const ffmpegBin = require("ffmpeg-static");

// Fonts in priority order — Avenir Next is the best looking
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Avenir Next.ttc",
  "/System/Library/Fonts/HelveticaNeue.ttc",
  "/System/Library/Fonts/Avenir.ttc",
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/ArialHB.ttc",
];

function findFont() {
  for (const fp of FONT_CANDIDATES) {
    if (existsSync(fp)) return fp;
  }
  return null;
}

/**
 * Escape special chars for ffmpeg drawtext filter.
 * Text is wrapped in single quotes (text='...'), so:
 *   - Backslash → \\ (escaped backslash)
 *   - Apostrophe ' → ' (U+2019 right single quotation mark — visually identical,
 *     avoids breaking the single-quoted filter string)
 *   - Colon → \:  (option separator)
 *   - Square brackets → \[ \]  (expression delimiters)
 */
function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")   // curly apostrophe — safe inside ffmpeg single-quoted text
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Wrap text into lines with max `maxChars` per line.
 * Returns array of strings (max 3 lines).
 */
function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  // Hard-cap at 4 lines (3 was too few — force-joining overflow made line 3 overflow the box)
  if (lines.length > 4) {
    lines[3] = lines.slice(3).join(" ");
    return lines.slice(0, 4);
  }
  return lines;
}

/**
 * Get video width & height using ffprobe (bundled with ffmpeg-static dir).
 */
function getVideoDimensions(inputPath) {
  // ffprobe is in the same directory as ffmpeg in ffmpeg-static
  const ffprobeBin = path.join(path.dirname(ffmpegBin), "ffprobe");
  const probeBin = existsSync(ffprobeBin) ? ffprobeBin : ffmpegBin.replace("ffmpeg", "ffprobe");

  try {
    const out = execFileSync(probeBin, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      inputPath,
    ]).toString();
    const data = JSON.parse(out);
    const videoStream = data.streams.find(s => s.codec_type === "video");
    if (videoStream) {
      return { w: videoStream.width, h: videoStream.height };
    }
  } catch {
    // fallback: try to get from ffmpeg -i
  }

  // Fallback: parse from ffmpeg -i stderr
  try {
    let stderr = "";
    try {
      execFileSync(ffmpegBin, ["-i", inputPath]);
    } catch (e) {
      stderr = e.stderr?.toString() || "";
    }
    const match = stderr.match(/(\d{3,4})x(\d{3,4})/);
    if (match) return { w: parseInt(match[1]), h: parseInt(match[2]) };
  } catch {}

  return { w: 720, h: 1280 }; // default portrait reel size
}

/**
 * Overlay a motivational quote on a video.
 *
 * @param {string} inputPath  - Absolute path to source .mp4
 * @param {string} quote      - The quote text to overlay
 * @param {string} [outputPath] - Output path (default: same dir, "-overlay" suffix)
 * @returns {Promise<string>} Path to the processed video
 */
export function overlayQuoteOnVideo(inputPath, quote, outputPath) {
  if (!outputPath) {
    const ext  = path.extname(inputPath);
    const base = inputPath.slice(0, -ext.length);
    outputPath = `${base}-overlay${ext}`;
  }

  const font = findFont();
  const fontOption = font ? `:fontfile='${escapeDrawtext(font)}'` : "";

  // Get source dimensions, then compute OUTPUT dimensions after 1080p cap.
  // CRITICAL: all text layout must use OUTPUT dimensions, because the scale filter
  // runs first in the chain — text is drawn onto the already-scaled frame.
  const { w: srcW, h: srcH } = getVideoDimensions(inputPath);
  console.log(`[overlay] Source dimensions: ${srcW}x${srcH}`);

  // Output dimensions after scale='min(1080,iw)':-2
  const outW = Math.min(1080, srcW);
  const outH = Math.round(srcH * (outW / srcW));
  // Ensure outH is divisible by 2 (libx264 requirement)
  const safeOutH = outH % 2 === 0 ? outH : outH - 1;
  console.log(`[overlay] Output dimensions: ${outW}x${safeOutH}`);

  // Char-wrap: 22 chars per line across all resolutions keeps text inside the box.
  // Wider lines look fine visually but overflow the box width at large font sizes.
  const maxChars = 22;
  const lines    = wrapText(quote, maxChars);
  const numLines = lines.length;

  // Typography — all in pixels relative to OUTPUT size.
  // Cap by BOTH frame height (readability) AND box width (no overflow).
  //   charWidthRatio ≈ 0.58 for Avenir Next / Helvetica Neue (proportional font)
  const boxW0          = Math.round(outW * 0.90);  // pre-compute for font-size cap
  const fontSizeByH    = Math.round(safeOutH * 0.042);
  const fontSizeByW    = Math.round(boxW0 / (maxChars * 0.58));
  const fontSize       = Math.min(fontSizeByH, fontSizeByW);
  const lineH      = Math.round(fontSize * 1.55);
  const padV       = Math.round(fontSize * 0.9);

  const textBlockH = numLines * lineH - Math.round(fontSize * 0.55);
  const boxH       = textBlockH + padV * 2;
  const boxY       = Math.round((safeOutH - boxH) / 2);
  const boxX       = Math.round(outW * 0.05);
  const boxW       = boxW0;   // already computed above
  const textStartY = boxY + padV;

  // Build filter chain (scale runs first, then draw onto scaled frame):
  //   1. scale     — cap at 1080p
  //   2. drawbox   — semi-transparent dark background
  //   3-N. drawtext — one per line
  const scaleFilter = `scale=${outW}:${safeOutH}`;   // explicit px, not expressions

  const drawBoxFilter =
    `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}` +
    `:color=black@0.65:t=fill`;

  const drawTextFilters = lines.map((line, i) => {
    const escaped = escapeDrawtext(line);
    const textY   = textStartY + i * lineH;
    return (
      `drawtext=text='${escaped}'` +
      `${fontOption}` +
      `:fontsize=${fontSize}` +
      `:fontcolor=white` +
      `:x=(w-text_w)/2` +
      `:y=${textY}` +
      `:shadowcolor=black@0.7` +
      `:shadowx=2:shadowy=2`
    );
  });

  const filterComplex = [scaleFilter, drawBoxFilter, ...drawTextFilters].join(",");

  console.log(`[overlay] Applying ${numLines}-line quote: "${quote}"`);
  console.log(`[overlay] Font: ${fontSize}px, box: ${boxX},${boxY} ${boxW}x${boxH}`);

  execFileSync(ffmpegBin, [
    "-i",  inputPath,
    "-vf", filterComplex,
    "-c:a", "copy",        // keep original audio untouched
    "-c:v", "libx264",
    "-crf", "18",          // high quality (18 = near-lossless visually; was 23)
    "-preset", "medium",   // better compression efficiency than "fast"
    "-pix_fmt", "yuv420p", // ensure broad compatibility
    "-movflags", "+faststart", // web-optimised — plays before fully downloaded
    "-y",                  // overwrite output if exists
    outputPath,
  ], { stdio: "pipe" });

  console.log(`[overlay] Done → ${outputPath}`);
  return outputPath;
}
