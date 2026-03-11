import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
const NEW_CAPTION = "Beautiful sunset 🌅 #sunset #sky #nature #photography #goldenhour";
const POST_URL = "https://www.instagram.com/mananb/p/DVfptEXFbdd8L1xfyWokpXI0D2L2JkbCuNgppA0/";

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
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

  await page.goto(POST_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // Click "..." More options
  await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('svg[aria-label="More options"]'));
    for (const svg of svgs) {
      let node = svg;
      for (let i = 0; i < 5; i++) {
        node = node.parentElement;
        if (!node) break;
        if (node.tagName === "BUTTON" || node.getAttribute("role") === "button") { node.click(); return; }
      }
    }
  });
  await sleep(2000);

  // Click Edit
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button'], div[role='menuitem']"));
    const edit = btns.find(b => b.textContent.trim() === "Edit" && b.offsetParent !== null);
    if (edit) edit.click();
  });
  await sleep(2500);

  // Dump all input/textarea elements to understand structure
  const inputs = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('textarea, input, div[contenteditable="true"]'));
    return els.map(el => ({
      tag: el.tagName,
      type: el.type,
      name: el.name,
      placeholder: el.placeholder,
      value: el.value?.substring(0, 50),
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null,
      rect: (() => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
    }));
  });
  log("Input elements: " + JSON.stringify(inputs, null, 2));

  // Use React's nativeInputValueSetter to set the caption
  log("Setting caption via React nativeInputValueSetter...");
  const captionSet = await page.evaluate((caption) => {
    const textarea = document.querySelector("textarea");
    if (!textarea) return "no textarea";

    // React's controlled input trick
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(textarea, caption);
    
    // Dispatch input and change events to trigger React's onChange
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    return "done: " + textarea.value.substring(0, 50);
  }, NEW_CAPTION);
  log("Caption set result: " + captionSet);
  await sleep(1500);
  
  // Verify the textarea shows the value
  const textareaValue = await page.evaluate(() => document.querySelector("textarea")?.value || "empty");
  log("Textarea value: " + textareaValue.substring(0, 80));
  
  await page.screenshot({ path: "/tmp/react-caption.png" });

  // Click Save
  log("Clicking Save...");
  const saved = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const save = btns.find(b => (b.textContent.trim() === "Done" || b.textContent.trim() === "Save") && b.offsetParent !== null);
    if (save) { save.click(); return save.textContent.trim(); }
    return "not found";
  });
  log("Save clicked: " + saved);
  await sleep(5000);
  await page.screenshot({ path: "/tmp/react-saved.png" });

  // Check final post text
  const finalText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  log("Final page text: " + finalText.substring(0, 200));
  
  await sleep(3000);
  await browser.close();
  log("Done!");
})();
