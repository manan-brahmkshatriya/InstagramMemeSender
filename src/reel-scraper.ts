import { instagramBrowser } from "./instagram-browser.js";
import { log, logError } from "./logger.js";
import type { ScrapedReel } from "./types.js";

/**
 * Scrape reels from a single Instagram hashtag page.
 * Returns up to `limit` ScrapedReel objects not in `alreadySentUrls`.
 */
async function scrapeByHashtag(
  hashtag: string,
  limit: number,
  alreadySentUrls: Set<string>
): Promise<ScrapedReel[]> {
  const page = instagramBrowser.getPage();
  const results: ScrapedReel[] = [];

  try {
    log(`reel-scraper: scraping hashtag #${hashtag} (limit ${limit})`);
    const candidateUrls = [
      `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`,
      `https://www.instagram.com/popular/${encodeURIComponent(hashtag)}/?utm_source=explore_tag`,
    ];

    const reelLinks: string[] = [];
    const seenReelLinks = new Set<string>();

    for (const tagUrl of candidateUrls) {
      await page.goto(tagUrl, { waitUntil: "networkidle2", timeout: 30000 });
      await instagramBrowser.randomDelay(2000, 4000);

      // Scroll a few times to trigger lazy loading of grid items.
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
        await instagramBrowser.randomDelay(1200, 2200);
      }

      // Extract reel/post links from current page.
      const linksOnPage: string[] = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        const links = new Set<string>();

        const normalize = (href: string): string | null => {
          if (!href) return null;
          const absolute = href.startsWith("http")
            ? href
            : `https://www.instagram.com${href.startsWith("/") ? "" : "/"}${href}`;
          const withoutQuery = absolute.replace(/\?.*$/, "");
          const match = withoutQuery.match(/https:\/\/www\.instagram\.com\/(reel|p)\/([^\/?#]+)/i);
          if (!match) return null;
          return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`;
        };

        for (const anchor of anchors) {
          const href =
            (anchor as HTMLAnchorElement).href ||
            (anchor as HTMLAnchorElement).getAttribute("href") ||
            "";
          const normalized = normalize(href);
          if (normalized) links.add(normalized);
        }
        return Array.from(links);
      });

      for (const link of linksOnPage) {
        if (!seenReelLinks.has(link)) {
          seenReelLinks.add(link);
          reelLinks.push(link);
        }
      }

      if (reelLinks.length >= 25) break;
    }

    log(`reel-scraper: found ${reelLinks.length} reel links for #${hashtag}`);

    // Visit each reel and extract video src
    for (const reelUrl of reelLinks) {
      if (results.length >= limit) break;

      // Skip if already sent to this thread
      if (alreadySentUrls.has(reelUrl)) {
        log(`reel-scraper: skipping already-sent reel: ${reelUrl}`);
        continue;
      }

      try {
        await page.goto(reelUrl, { waitUntil: "networkidle2", timeout: 30000 });
        await instagramBrowser.randomDelay(1500, 3000);

        const canonicalUrl =
          (await page.evaluate(() => {
            const ogUrl = document.querySelector('meta[property="og:url"]');
            const href = ogUrl?.getAttribute("content") ?? "";
            if (!href) return null;
            const clean = href.replace(/\?.*$/, "");
            const match = clean.match(/https:\/\/www\.instagram\.com\/(reel|p)\/([^\/?#]+)/i);
            if (!match) return null;
            return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`;
          })) ?? reelUrl;

        // Extract a direct video URL (avoid blob: URLs that cannot be downloaded).
        const videoSrc = await page.evaluate(() => {
          const isHttpUrl = (value: string | null | undefined): value is string =>
            Boolean(value && /^https?:\/\//i.test(value));

          const pickFirstHttp = (values: Array<string | null | undefined>): string | null => {
            for (const value of values) {
              if (isHttpUrl(value)) return value;
            }
            return null;
          };

          const video = document.querySelector("video");
          const domVideoSrc = pickFirstHttp([
            video?.getAttribute("src"),
            (video as HTMLVideoElement | null)?.currentSrc,
            video?.querySelector("source")?.getAttribute("src"),
          ]);
          if (domVideoSrc) return domVideoSrc;

          const ogVideo = pickFirstHttp([
            document
              .querySelector('meta[property="og:video"]')
              ?.getAttribute("content"),
            document
              .querySelector('meta[property="og:video:secure_url"]')
              ?.getAttribute("content"),
          ]);
          if (ogVideo) return ogVideo;

          // Fallback: parse embedded JSON for video_url.
          for (const script of Array.from(document.querySelectorAll("script[type='application/ld+json'], script"))) {
            const text = script.textContent || "";
            if (!text || !text.includes("video_url")) continue;
            const match = text.match(/"video_url"\s*:\s*"([^"]+)"/);
            if (match?.[1]) {
              const candidate = match[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
              if (isHttpUrl(candidate)) return candidate;
            }
          }

          return null;
        });

        if (!videoSrc) {
          log(`reel-scraper: no video src found at ${reelUrl}`);
          continue;
        }

        // Try to extract caption (non-critical, fallback to empty)
        const caption = await page.evaluate(() => {
          // Try og:description meta tag first (most reliable)
          const ogDesc = document.querySelector('meta[property="og:description"]');
          if (ogDesc?.getAttribute("content")) {
            return ogDesc.getAttribute("content")?.slice(0, 300) ?? "";
          }
          // Fallback: find description meta
          const metaDesc = document.querySelector('meta[name="description"]');
          return metaDesc?.getAttribute("content")?.slice(0, 300) ?? "";
        });

        results.push({
          reelUrl: canonicalUrl,
          videoSrc,
          caption: caption || undefined,
          hashtag,
        });

        log(`reel-scraper: collected reel ${canonicalUrl}`);
        await instagramBrowser.randomDelay(2000, 4000);
      } catch (err) {
        logError(`reel-scraper: failed to extract reel at ${reelUrl}`, err);
        // Continue to next reel
      }
    }
  } catch (err) {
    logError(`reel-scraper: failed to scrape hashtag #${hashtag}`, err);
  }

  return results;
}

/**
 * Lightweight scrape: collect reel URLs from hashtag pages only.
 * Does NOT visit individual reel pages — no video extraction, no captions.
 * Returns up to `totalLimit` unseen canonical reel URLs.
 */
export async function scrapeReelUrlsOnly(
  hashtags: string[],
  totalLimit: number,
  alreadySentUrls: Set<string>
): Promise<string[]> {
  await instagramBrowser.ensureLoggedIn();

  const page = instagramBrowser.getPage();
  const collected: string[] = [];
  const seen = new Set<string>();

  for (const hashtag of hashtags) {
    if (collected.length >= totalLimit) break;

    try {
      log(`reel-scraper: (urls-only) scraping hashtag #${hashtag}`);
      await page.goto(
        `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`,
        { waitUntil: "networkidle2", timeout: 30000 }
      );
      await instagramBrowser.randomDelay(2000, 4000);

      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
        await instagramBrowser.randomDelay(1000, 2000);
      }

      const links: string[] = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        const result = new Set<string>();
        for (const a of anchors) {
          const href =
            (a as HTMLAnchorElement).href ||
            (a as HTMLAnchorElement).getAttribute("href") ||
            "";
          const clean = href.replace(/\?.*$/, "");
          const m = clean.match(
            /https:\/\/www\.instagram\.com\/(reel|p)\/([^\/?#]+)/i
          );
          if (m)
            result.add(
              `https://www.instagram.com/${m[1].toLowerCase()}/${m[2]}/`
            );
        }
        return Array.from(result);
      });

      for (const url of links) {
        if (collected.length >= totalLimit) break;
        if (seen.has(url) || alreadySentUrls.has(url)) continue;
        seen.add(url);
        collected.push(url);
        log(`reel-scraper: (urls-only) queued ${url}`);
      }
    } catch (err) {
      logError(`reel-scraper: (urls-only) failed for #${hashtag}`, err);
    }

    if (collected.length < totalLimit && hashtags.indexOf(hashtag) < hashtags.length - 1) {
      await instagramBrowser.randomDelay(2000, 4000);
    }
  }

  return collected.slice(0, totalLimit);
}

/**
 * Scrape reels for a set of hashtags, deduplicating against already-sent URLs.
 * Returns up to `totalLimit` unique, unseen ScrapedReel objects.
 */
export async function scrapeForCategories(
  hashtags: string[],
  totalLimit: number,
  alreadySentUrls: Set<string>
): Promise<ScrapedReel[]> {
  await instagramBrowser.ensureLoggedIn();

  const all: ScrapedReel[] = [];
  const perHashtag = Math.ceil(totalLimit / Math.max(hashtags.length, 1)) + 3;

  for (const hashtag of hashtags) {
    if (all.length >= totalLimit) break;

    const remaining = totalLimit - all.length;
    const scraped = await scrapeByHashtag(
      hashtag,
      Math.min(perHashtag, remaining),
      alreadySentUrls
    );
    all.push(...scraped);

    // Delay between hashtags
    if (hashtags.indexOf(hashtag) < hashtags.length - 1) {
      await instagramBrowser.randomDelay(3000, 6000);
    }
  }

  return all.slice(0, totalLimit);
}
