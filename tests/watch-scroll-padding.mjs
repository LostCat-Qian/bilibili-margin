// 播放页顶栏是 fixed 的 72px 玻璃条：「看评论」等跳转要把落点让到顶栏下方，不能把评论标题和输入框压在顶栏底下。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/watch-scroll-padding');
mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-watch-pad-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1600, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, weather: false, footprint: false, bg: { mode: 'off' }, theme: 'dark', autoWeb: false, wide: false } }));
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
  await page.locator('#margin-watch-top').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.documentElement.classList.contains('margin-watch'));
  // 离线页面很短：把标题区和评论区撑高，让跳转真的需要滚动
  await page.evaluate(() => {
    document.querySelector('.video-info-container').style.minHeight = '1600px';
    document.querySelector('#commentapp').style.minHeight = '2400px';
  });
  const bar = await page.evaluate(() => document.getElementById('margin-watch-top').getBoundingClientRect().height);
  assert.equal(bar, 72);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop), '96px', 'watch pages reserve the fixed header for scroll targets');

  // 与命令面板「看评论」相同的调用
  await page.evaluate(() => document.querySelector('#commentapp, bili-comments, .comment-container')?.scrollIntoView({ behavior: 'instant', block: 'start' }));
  await page.waitForTimeout(300);
  const top = await page.evaluate(() => document.querySelector('#commentapp').getBoundingClientRect().top);
  assert(top >= bar, `comments must land below the header: top=${top}`);
  assert.equal(Math.round(top), 96);
  const hit = await page.evaluate(() => document.elementsFromPoint(innerWidth / 2, 8).map((e) => e.id || e.tagName).slice(0, 2));
  assert(hit.includes('margin-watch-top'), 'the header still sits on top at the viewport edge');
  results.push('scroll targets land 96px down, right below the 72px header');
  await page.screenshot({ path: join(out, 'jump.png') });

  // 网页全屏时顶栏收起，不再让位
  await page.evaluate(() => document.documentElement.classList.add('margin-webscreen'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop), 'auto', 'no reservation while the header is hidden in web fullscreen');
  await page.evaluate(() => document.documentElement.classList.remove('margin-webscreen'));
  results.push('web fullscreen keeps the reservation off while the header is hidden');
  await page.goto('https://search.bilibili.com/all?keyword=test');
  const track = page.locator('#margin-watch-top .sr-track');
  await track.waitFor({ state: 'attached' });
  await page.evaluate(() => {
    document.body.style.height = '100vh';
    const results = document.createElement('div');
    document.body.append(results);
    results.style.height = '400vh';
    scrollTo(0, innerHeight + 100);
  });
  const back = page.getByRole('button', { name: '返回顶部', exact: true });
  await back.waitFor();
  assert(parseInt(await page.locator('#margin-watch-top .sr-pct').textContent()) > 0);
  const bounds = await track.boundingBox();
  await track.click({ position: { x: 6, y: bounds.height * .85 } });
  await page.waitForFunction(() => scrollY / (document.documentElement.scrollHeight - innerHeight) > .8);
  await back.click();
  await page.waitForFunction(() => scrollY === 0);
  assert(await back.isHidden());
  results.push('search result overflow updates the ruler, accepts a jump and returns to the top');
  assert.deepEqual(errors, []);
  results.forEach((result) => console.log('PASS ' + result));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
