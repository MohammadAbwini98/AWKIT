import { chromium } from 'playwright';

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    let count = 0;
    for (const context of contexts) {
      for (const page of context.pages()) {
        const url = page.url();
        if (url.includes('dribbble.com')) {
          console.log('Found Dribbble page:', url);
          const path = `C:\\Users\\moham\\.gemini\\antigravity-ide\\scratch\\dribbble_${count}.png`;
          await page.screenshot({ path, fullPage: true });
          console.log('Saved screenshot:', path);
          count++;
        }
      }
    }
    await browser.close();
    console.log('Done.');
  } catch (err) {
    console.error(err);
  }
})();
