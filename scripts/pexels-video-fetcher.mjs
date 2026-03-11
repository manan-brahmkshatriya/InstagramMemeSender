/**
 * pexels-video-fetcher.mjs
 * Fetches motivational/inspirational short videos from the Pexels free API
 * and downloads them to /tmp/reel-generator/.
 *
 * Exports:
 *   fetchAndDownloadPexelsVideo(theme, apiKey, postedVideoIds, page?) → { videoId, filePath, width, height }
 *   cleanupVideoFile(filePath)
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";

const TMP_DIR = "/tmp/reel-generator";

function log(msg) {
  console.log(`[${new Date().toISOString()}] [pexels] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ── Pexels API GET ──────────────────────────────────────────────────────────
function pexelsGet(url, apiKey) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        Authorization: apiKey,
        "User-Agent": "InstagramReelBot/1.0",
        Accept: "application/json",
      },
      timeout: 15000,
    };

    const req = https.get(options, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Pexels API ${res.statusCode}: ${body.substring(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message} — body: ${body.substring(0, 100)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Pexels API request timed out"));
    });
  });
}

// ── File downloader with redirect following ────────────────────────────────
function downloadFile(url, destPath, depth = 0) {
  if (depth > 5) return Promise.reject(new Error("Too many redirects"));

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        Referer: "https://www.pexels.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      timeout: 120000,
    };

    const req = protocol.get(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.origin}${res.headers.location}`;
        res.resume(); // drain
        return downloadFile(redirectUrl, destPath, depth + 1).then(resolve).catch(reject);
      }

      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading video`));
      }

      const total = parseInt(res.headers["content-length"] || "0", 10);
      let received = 0;
      let lastLogAt = 0;

      const fileStream = fs.createWriteStream(destPath);
      res.on("data", chunk => {
        received += chunk.length;
        if (received - lastLogAt > 15 * 1024 * 1024) {
          log(
            `  → ${(received / 1024 / 1024).toFixed(1)} MB` +
            (total ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : "")
          );
          lastLogAt = received;
        }
      });

      res.pipe(fileStream);
      fileStream.on("finish", () => { fileStream.close(); resolve(); });
      fileStream.on("error", err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    req.on("error", err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
    req.on("timeout", () => {
      req.destroy();
      fs.unlink(destPath, () => {});
      reject(new Error("Download timed out"));
    });
  });
}

// ── Best video file selector ───────────────────────────────────────────────
// Priority: portrait+hd > portrait-any > hd-any > first available
function selectBestVideoFile(videoFiles) {
  const isPortrait = f => f.width > 0 && f.height > 0 && f.width < f.height;
  const isHD       = f => f.quality === "hd";

  const portraitHD  = videoFiles.filter(f => isPortrait(f) && isHD(f));
  if (portraitHD.length > 0) return portraitHD[0];

  const portraitAny = videoFiles.filter(f => isPortrait(f));
  if (portraitAny.length > 0) return portraitAny[0];

  const hdAny = videoFiles.filter(f => isHD(f));
  if (hdAny.length > 0) return hdAny[0];

  return videoFiles[0] ?? null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a Pexels video for the given theme, skip already-posted IDs,
 * download to /tmp/reel-generator/, and return metadata.
 *
 * @param {string}   theme         - e.g. "sunrise motivation"
 * @param {string}   apiKey        - Pexels API key
 * @param {number[]} postedVideoIds - IDs to skip
 * @param {number}   pageNum       - Pexels results page (auto-incremented on exhaustion)
 */
export async function fetchAndDownloadPexelsVideo(
  theme,
  apiKey,
  postedVideoIds = [],
  pageNum = 1
) {
  ensureTmpDir();

  const query = encodeURIComponent(theme);
  const url = `https://api.pexels.com/videos/search?query=${query}&per_page=15&orientation=portrait&page=${pageNum}`;

  log(`Searching Pexels: "${theme}" (page ${pageNum})`);
  const data = await pexelsGet(url, apiKey);

  if (!data.videos || data.videos.length === 0) {
    throw new Error(`No Pexels videos found for theme: "${theme}"`);
  }

  // Filter out already-posted videos
  const postedSet = new Set(postedVideoIds);
  const candidates = data.videos.filter(v => !postedSet.has(v.id));

  if (candidates.length === 0) {
    if (pageNum < 5) {
      log(`All ${data.videos.length} results on page ${pageNum} already used — trying page ${pageNum + 1}`);
      await sleep(500);
      return fetchAndDownloadPexelsVideo(theme, apiKey, postedVideoIds, pageNum + 1);
    }
    throw new Error(`All available Pexels videos for theme "${theme}" have been used`);
  }

  // Pick randomly from candidates to avoid always taking the top result
  const video = candidates[Math.floor(Math.random() * candidates.length)];
  const bestFile = selectBestVideoFile(video.video_files ?? []);

  if (!bestFile || !bestFile.link) {
    throw new Error(`No usable video file for Pexels video ID ${video.id}`);
  }

  log(
    `Selected: ID=${video.id}  ${bestFile.width}x${bestFile.height}  ` +
    `quality=${bestFile.quality}  URL=${bestFile.link.substring(0, 60)}...`
  );

  const destPath = path.join(TMP_DIR, `pexels-${video.id}-${Date.now()}.mp4`);
  log(`Downloading → ${destPath}`);

  await downloadFile(bestFile.link, destPath);

  const stat = fs.statSync(destPath);
  if (stat.size === 0) {
    fs.unlinkSync(destPath);
    throw new Error(`Downloaded file is empty for Pexels video ID ${video.id}`);
  }

  log(`Downloaded ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

  return {
    videoId:  video.id,
    filePath: destPath,
    width:    bestFile.width,
    height:   bestFile.height,
    quality:  bestFile.quality,
  };
}

/**
 * Delete a downloaded video file (called after successful or failed upload).
 */
export function cleanupVideoFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log(`Cleaned up: ${filePath}`);
    }
  } catch (err) {
    log(`Warning: could not delete ${filePath}: ${err.message}`);
  }
}
