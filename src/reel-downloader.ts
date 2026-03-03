import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { log, logError } from "./logger.js";
import type { ScrapedReel, DownloadedReel } from "./types.js";

const TMP_DIR = "/tmp/instagram-reels";

function ensureTmpDir(): void {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

/**
 * Download a scraped reel's video to /tmp/instagram-reels/<reelId>_<ts>.mp4.
 * The Referer header is required — Instagram's CDN returns 403 without it.
 * Must be called immediately after scraping (CDN URLs expire quickly).
 */
export async function downloadReel(reel: ScrapedReel): Promise<DownloadedReel> {
  ensureTmpDir();

  const reelId = reel.reelUrl.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
  const tmpFilePath = path.join(TMP_DIR, `${reelId}_${Date.now()}.mp4`);

  log(`reel-downloader: downloading to ${tmpFilePath}`);

  await downloadToFile(reel.videoSrc, tmpFilePath);

  const stat = fs.statSync(tmpFilePath);
  if (stat.size === 0) {
    fs.unlinkSync(tmpFilePath);
    throw new Error(`Downloaded file is empty for reel: ${reel.reelUrl}`);
  }

  log(`reel-downloader: downloaded ${stat.size} bytes`);

  return {
    tmpFilePath,
    fileSize: stat.size,
    caption: reel.caption ?? "",
    reelUrl: reel.reelUrl,
  };
}

function downloadToFile(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const protocol = url.startsWith("https") ? https : http;

    const request = protocol.get(
      url,
      {
        headers: {
          Referer: "https://www.instagram.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (response) => {
        // Follow redirects
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fs.unlink(filePath, () => {});
          downloadToFile(response.headers.location, filePath).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode && response.statusCode >= 400) {
          file.close();
          fs.unlink(filePath, () => {});
          reject(new Error(`CDN returned HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
        file.on("error", (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      }
    );

    request.on("error", (err) => {
      file.close();
      fs.unlink(filePath, () => {});
      reject(err);
    });

    // 60-second download timeout
    request.setTimeout(60000, () => {
      request.destroy();
      file.close();
      fs.unlink(filePath, () => {});
      reject(new Error("Download timed out after 60s"));
    });
  });
}

export function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log(`reel-downloader: cleaned up ${filePath}`);
    }
  } catch (err) {
    logError("reel-downloader: cleanupTempFile failed", err);
  }
}

/** Delete .mp4 files in /tmp/instagram-reels/ older than 1 hour */
export function cleanupOldTempFiles(): void {
  try {
    if (!fs.existsSync(TMP_DIR)) return;
    const files = fs.readdirSync(TMP_DIR);
    const cutoff = Date.now() - 60 * 60 * 1000;
    let cleaned = 0;
    for (const file of files) {
      if (!file.endsWith(".mp4")) continue;
      const fullPath = path.join(TMP_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
          cleaned++;
        }
      } catch {
        // ignore individual file errors
      }
    }
    if (cleaned > 0) log(`reel-downloader: cleaned up ${cleaned} old temp files`);
  } catch (err) {
    logError("reel-downloader: cleanupOldTempFiles failed", err);
  }
}
