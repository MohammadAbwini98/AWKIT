import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    let videoData = [];
    for (const context of contexts) {
      for (const page of context.pages()) {
        const url = page.url();
        if (url.includes('dribbble.com')) {
          const videos = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('video, source')).map(v => v.src || v.currentSrc).filter(Boolean);
          });
          if (videos.length > 0) {
            videoData.push({ url, videos: [...new Set(videos)] });
          }
        }
      }
    }
    console.log(JSON.stringify(videoData, null, 2));
    browser.disconnect();
  } catch (err) {
    console.error("Error:", err);
  }
})();
