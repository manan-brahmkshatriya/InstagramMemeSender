import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  await page.setCookie(...cookies);

  await page.goto("https://www.instagram.com/mananb/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4000);

  // Get post count
  const postCount = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll("span"));
    // Look for the posts count
    for (const s of spans) {
      if (s.textContent.trim().match(/^\d+$/) && s.closest('li')) {
        const li = s.closest('li');
        if (li.textContent.includes('post')) return s.textContent.trim();
      }
    }
    return null;
  });
  console.log("Post count element:", postCount);

  // Get all post links (most recent first)
  const posts = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"]'));
    return anchors.slice(0, 6).map(a => ({
      href: a.href,
      imgSrc: a.querySelector('img')?.src?.substring(0, 80)
    }));
  });
  console.log("Recent posts:", JSON.stringify(posts, null, 2));

  // Screenshot the grid area
  await page.screenshot({ path: "/tmp/profile-grid.png", clip: { x: 0, y: 230, width: 1280, height: 400 } });
  console.log("Grid screenshot saved to /tmp/profile-grid.png");

  await browser.close();
})();
