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
 * Escape special chars for ffmpeg drawtext filter:
 *   ' → \' and : → \: and \ → \\
 */
function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
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

  // Hard-cap at 3 lines
  if (lines.length > 3) {
    lines[2] = lines.slice(2).join(" ");
    return lines.slice(0, 3);
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

  // Get actual dimensions for precise scaling
  const { w, h } = getVideoDimensions(inputPath);
  console.log(`[overlay] Video dimensions: ${w}x${h}`);

  // Scale: wrap at ~22 chars for narrow (≤480px), ~30 for wider
  const maxChars = w <= 480 ? 22 : 30;
  const lines = wrapText(quote, maxChars);
  const numLines = lines.length;

  // Typography — all in pixels relative to actual video size
  const fontSize   = Math.round(h * 0.057);          // ~57px for 1000px height
  const lineH      = Math.round(fontSize * 1.55);     // line-to-line spacing
  const padV       = Math.round(fontSize * 0.9);      // vertical padding inside box
  const padH       = Math.round(w * 0.05);            // horizontal padding inside box

  const textBlockH  = numLines * lineH - Math.round(fontSize * 0.55); // total text block height
  const boxH        = textBlockH + padV * 2;
  const boxY        = Math.round((h - boxH) / 2);     // centered vertically
  const boxX        = Math.round(w * 0.05);
  const boxW        = Math.round(w * 0.90);

  const textStartY  = boxY + padV;

  // Build filter chain:
  //   1. drawbox  — semi-transparent dark background
  //   2-N. drawtext — one per line
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

  const filterComplex = [drawBoxFilter, ...drawTextFilters].join(",");

  console.log(`[overlay] Applying ${numLines}-line quote: "${quote}"`);
  console.log(`[overlay] Font size: ${fontSize}px, box: ${boxX},${boxY} ${boxW}x${boxH}`);

  execFileSync(ffmpegBin, [
    "-i",  inputPath,
    "-vf", filterComplex,
    "-c:a", "copy",        // keep original audio untouched
    "-c:v", "libx264",
    "-crf", "23",          // good quality, reasonable file size
    "-preset", "fast",
    "-y",                  // overwrite output if exists
    outputPath,
  ], { stdio: "pipe" });

  console.log(`[overlay] Done → ${outputPath}`);
  return outputPath;
}
