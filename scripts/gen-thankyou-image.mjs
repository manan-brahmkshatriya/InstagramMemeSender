/**
 * Generates a "thank you" image on Craiyon and saves it locally.
 */
import puppeteer from "puppeteer";
import https from "https";
import fs from "fs";
import { execSync } from "child_process";

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  log("Opening Craiyon...");
  await page.goto("https://www.craiyon.com/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(2000);

  // Type the prompt
  const prompt = "beautiful thank you card with flowers and warm colors, elegant design, gratitude";
  log(`Typing prompt: "${prompt}"`);
  const promptBox = await page.$('textarea, input[type="text"], input[placeholder*="prompt"], #prompt');
  if (!promptBox) {
    log("No prompt box found, trying by placeholder...");
    const inputs = await page.$$('input, textarea');
    for (const inp of inputs) {
      const ph = await inp.evaluate(el => el.placeholder || '');
      log("Input placeholder: " + ph);
    }
  }
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
    const inp = inputs.find(el => el.offsetParent !== null);
    if (inp) inp.focus();
  });
  await page.keyboard.down("Meta");
  await page.keyboard.press("a");
  await page.keyboard.up("Meta");
  await page.keyboard.type(prompt, { delay: 20 });
  await sleep(500);

  // Click Draw
  log("Clicking Draw button...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const draw = btns.find(b => b.textContent.trim() === "Draw" || b.textContent.includes("Draw"));
    if (draw) draw.click();
  });

  // Wait for generation (up to 90s)
  log("Waiting for generation...");
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const done = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[src*="img.craiyon.com"]'));
      return imgs.length > 0;
    });
    if (done) { log(`Images ready after ${i+1}s`); break; }
    if (i % 10 === 0) log(`Still waiting... ${i}s`);
  }

  await sleep(2000);

  // Get image URLs
  const imgUrls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img[src*="img.craiyon.com"]'))
      .map(img => img.src)
      .filter(src => src.length > 0)
      .slice(0, 3);
  });
  log("Image URLs found: " + imgUrls.length);
  if (imgUrls.length === 0) {
    log("No images found");
    await browser.close(); process.exit(1);
  }

  log("Downloading: " + imgUrls[0]);
  await downloadFile(imgUrls[0], "/tmp/thankyou-0.webp");

  // Convert webp → jpg
  execSync("sips -s format jpeg /tmp/thankyou-0.webp --out /tmp/thankyou-final.jpg");
  log("Converted to JPEG: /tmp/thankyou-final.jpg");

  await browser.close();
  log("Done! Image saved at /tmp/thankyou-final.jpg");
})();
