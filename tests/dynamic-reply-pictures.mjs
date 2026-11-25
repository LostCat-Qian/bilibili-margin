// 动态评论区里的配图也用页内查看器打开（和正文配图一致），不再新开标签页直接打开原图；中键 / Ctrl 点仍按链接打开。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/dynamic-reply-pictures');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const PICS = ['https://i0.hdslb.com/bfs/new_dyn/reply-a.png', 'https://i0.hdslb.com/bfs/new_dyn/reply-b.jpg'];
const item = { id_str: '9001', type: 'DYNAMIC_TYPE_WORD', basic: { comment_type: 17, comment_id_str: '9001' },
  modules: { module_author: { mid: 1, name: '映间编辑部', face: 'https://i0.hdslb.com/bfs/mock/avatar.jpg', pub_ts: Math.floor(Date.now() / 1000) },
    module_dynamic: { desc: { text: '评论配图验证' } }, module_stat: { comment: { count: 1 }, like: { count: 2 }, forward: { count: 0 } } } };
const reply = { rpid: 501, member: { uname: '贴图读者', mid: 501, avatar: 'https://i0.hdslb.com/bfs/mock/avatar.jpg' },
  content: { message: '看这张图', pictures: PICS.map(img_src => ({ img_src })) }, rcount: 0 };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-reply-pics-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  await installMocks(ctx, async (url) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/feed/all')) return { code: 0, data: { items: [item], has_more: false, offset: '' } };
    if (p === '/x/v2/reply') return { code: 0, data: { replies: [reply], page: { count: 1, size: 8 } } };
    return undefined;
  });
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, weather: false, footprint: false, feedFollowList: false, bg: { mode: 'off' }, theme: 'dark' } }));
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://t.bilibili.com/');
  const card = page.locator('.fd-list > .dy').first(); await card.waitFor();
  await card.locator(':scope > .dy-foot > .dy-stat').getByRole('button', { name: /^评论 / }).click();
  const pics = card.locator('.dy-cbox .dy-r a[href^="https://i0.hdslb.com/bfs/new_dyn/"]'); await pics.first().waitFor();
  assert.equal(await pics.count(), 2, 'reply pictures render as links');
  assert.equal(await pics.first().getAttribute('href'), PICS[0], 'the link keeps the original image for open-in-new-tab gestures');
  const pagesBefore = ctx.pages().length;

  await pics.nth(1).click();
  const lightbox = page.locator('#margin-root .lb[role="dialog"][aria-label="查看图片"]'); await lightbox.waitFor();
  await page.waitForFunction(() => !!document.getElementById('margin-root')?.shadowRoot?.querySelector('.lb-img')?.naturalWidth);
  assert.equal(await lightbox.locator('.lb-count').textContent(), '2 / 2', 'the viewer starts on the clicked picture');
  assert.equal(await lightbox.locator('.lb-th').count(), 2);
  assert.equal(ctx.pages().length, pagesBefore, 'no tab is opened for a plain click');
  await page.screenshot({ path: join(out, 'reply-pictures.png') });
  await page.keyboard.press('ArrowLeft');
  assert.equal(await lightbox.locator('.lb-count').textContent(), '1 / 2');
  await lightbox.locator('.lb-stage').click({ position: { x: 400, y: 12 } });
  await lightbox.waitFor({ state: 'detached' });
  results.push('reply pictures open the in-page viewer, navigate and close on the backdrop');

  // Ctrl 点仍按链接新标签打开原图
  const opened = ctx.waitForEvent('page');
  await pics.first().click({ modifiers: ['Control'] });
  const tab = await opened; await tab.waitForLoadState();
  assert.equal(tab.url(), PICS[0]);
  assert.equal(await page.locator('#margin-root .lb').count(), 0, 'ctrl-click does not open the viewer');
  await tab.close();
  results.push('ctrl-click still opens the original image in a new tab');
  assert.deepEqual(errors, []);
  results.forEach((result) => console.log('PASS ' + result));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
