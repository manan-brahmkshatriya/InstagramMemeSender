/**
 * pixabay-music-fetcher.mjs
 * Downloads royalty-free instrumental music from the Pixabay free API
 * and stores tracks in scripts/music/ for background audio mixing.
 *
 * All Pixabay music is 100% free — no attribution required.
 * API docs: https://pixabay.com/api/docs/
 *
 * Exports:
 *   ensureMusicLibrary(apiKey, minTracks?)  → Promise<number>  (ensures N tracks exist)
 *   fetchAndDownloadPixabayMusic(mood, apiKey) → Promise<string>  (downloads one track)
 */

import https from "https";
import http  from "http";
import fs    from "fs";
import path  from "path";
import { fileURLToPath } from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR  = path.join(__dirname, "music");

// Moods to rotate through when filling the library
const MOODS = [
  "motivational",
  "uplifting",
  "inspiring",
  "cinematic",
  "epic",
  "positive",
  "background ambient",
  "corporate",
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] [pixabay-music] ${msg}`);
}

function ensureMusicDir() {
  if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// ── Pixabay API GET ──────────────────────────────────────────────────────────
function pixabayGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "InstagramReelBot/1.0",
        Accept:       "application/json",
      },
      timeout: 15000,
    }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Pixabay API ${res.statusCode}: ${body.substring(0, 300)}`));
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
      reject(new Error("Pixabay API request timed out"));
    });
  });
}

// ── File downloader with redirect following ────────────────────────────────
function downloadFile(url, destPath, depth = 0) {
  if (depth > 5) return Promise.reject(new Error("Too many redirects"));

  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const protocol = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  { "User-Agent": "InstagramReelBot/1.0" },
      timeout:  60000,
    };

    const req = protocol.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : `${parsed.origin}${res.headers.location}`;
        res.resume();
        return downloadFile(redirectUrl, destPath, depth + 1).then(resolve).catch(reject);
      }

      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading audio`));
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on("finish", () => { fileStream.close(); resolve(); });
      fileStream.on("error", err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    req.on("error", err => { fs.unlink(destPath, () => {}); reject(err); });
    req.on("timeout", () => {
      req.destroy();
      fs.unlink(destPath, () => {});
      reject(new Error("Download timed out"));
    });
  });
}

// ── Read already-downloaded track IDs from filenames ─────────────────────
function getDownloadedIds() {
  try {
    if (!fs.existsSync(MUSIC_DIR)) return new Set();
    return new Set(
      fs.readdirSync(MUSIC_DIR)
        .filter(f => f.startsWith("pixabay-"))
        .map(f => parseInt(f.split("-")[1]))
        .filter(id => !isNaN(id))
    );
  } catch {
    return new Set();
  }
}

// ── Extract audio URL from a Pixabay music hit ─────────────────────────────
// Pixabay returns different field names depending on API version / media type.
// We try all known variants in priority order.
function extractAudioUrl(hit) {
  // Direct audio fields (music API)
  if (hit.audio_url)    return hit.audio_url;
  if (hit.previewURL)   return hit.previewURL;
  if (hit.mp3_url)      return hit.mp3_url;
  if (hit.contentURL)   return hit.contentURL;
  if (hit.webformatURL) return hit.webformatURL; // image API — won't apply but safe to try
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Download one music track from Pixabay matching the given mood.
 * Skips IDs already present in scripts/music/.
 *
 * @param {string} mood   - Search term e.g. "motivational", "uplifting"
 * @param {string} apiKey - Pixabay API key
 * @returns {Promise<string>} Absolute path to the downloaded .mp3 file
 */
export async function fetchAndDownloadPixabayMusic(mood, apiKey) {
  ensureMusicDir();

  const downloadedIds = getDownloadedIds();
  const query = encodeURIComponent(mood);
  const url   = `https://pixabay.com/api/?key=${apiKey}&media_type=music&q=${query}&per_page=50&order=popular`;

  log(`Searching Pixabay Music: "${mood}"`);
  const data = await pixabayGet(url);

  if (!data.hits || data.hits.length === 0) {
    throw new Error(`No Pixabay music found for mood: "${mood}"`);
  }

  // Debug: log field names of first hit so we can diagnose any URL extraction issues
  if (data.hits.length > 0) {
    log(`API hit fields: ${Object.keys(data.hits[0]).join(", ")}`);
  }

  // Filter already downloaded
  const candidates = data.hits.filter(h => !downloadedIds.has(h.id));

  if (candidates.length === 0) {
    throw new Error(`All Pixabay "${mood}" tracks already downloaded (${data.hits.length} checked)`);
  }

  // Pick randomly from candidates
  const hit      = candidates[Math.floor(Math.random() * candidates.length)];
  const audioUrl = extractAudioUrl(hit);

  if (!audioUrl) {
    log(`⚠ No audio URL found on hit. All fields: ${JSON.stringify(hit)}`);
    throw new Error(`No audio URL field found for Pixabay track ID ${hit.id}`);
  }

  // Sanitise title for use as filename
  const rawTitle  = (hit.tags || `track-${hit.id}`).split(",")[0].trim();
  const safeTitle = rawTitle.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
  const destPath  = path.join(MUSIC_DIR, `pixabay-${hit.id}-${safeTitle}.mp3`);

  log(`Downloading: ID=${hit.id}  tags="${hit.tags}"  duration=${hit.duration}s`);
  log(`  URL: ${audioUrl.substring(0, 80)}...`);

  await downloadFile(audioUrl, destPath);

  const stat = fs.statSync(destPath);
  if (stat.size < 5000) {
    fs.unlinkSync(destPath);
    throw new Error(`Downloaded file suspiciously small (${stat.size} bytes) for ID ${hit.id} — likely not a valid audio file`);
  }

  log(`✅ Downloaded ${(stat.size / 1024).toFixed(0)} KB → ${path.basename(destPath)}`);
  return destPath;
}

/**
 * Ensure scripts/music/ has at least `minTracks` audio files.
 * Downloads from Pixabay as needed, rotating through different moods.
 *
 * @param {string} apiKey    - Pixabay API key
 * @param {number} minTracks - Target minimum track count (default 8)
 * @returns {Promise<number>} Total tracks in library after operation
 */
export async function ensureMusicLibrary(apiKey, minTracks = 8) {
  ensureMusicDir();

  const existing = fs.readdirSync(MUSIC_DIR)
    .filter(f => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f));

  if (existing.length >= minTracks) {
    log(`Music library OK: ${existing.length} tracks available`);
    return existing.length;
  }

  const needed = minTracks - existing.length;
  log(`Music library has ${existing.length} track(s) — downloading ${needed} more...`);

  let downloaded = 0;
  for (let i = 0; i < needed; i++) {
    const mood = MOODS[i % MOODS.length];
    try {
      await fetchAndDownloadPixabayMusic(mood, apiKey);
      downloaded++;
      // Respect Pixabay rate limits — 1 second between requests
      if (i < needed - 1) await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      log(`⚠ Failed to download "${mood}" track: ${err.message}`);
    }
  }

  const total = fs.readdirSync(MUSIC_DIR)
    .filter(f => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f)).length;
  log(`Music library ready: ${total} tracks total (${downloaded} newly downloaded)`);
  return total;
}
