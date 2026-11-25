// 播放页 / 搜索页顶栏整条透明：两侧空白不能拦截点击，只有搜索框、快捷入口、品牌等真实控件接收事件；抽屉和悬浮菜单照常可用。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/watch-header-pointer-events');
mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-watch-hit-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1920, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
// 顶栏高度 35px 处，从左到右每隔 16px 取一点，在 Shadow Root 内部做命中测试（document 层会被重定向到宿主）：
// 穿过带子落到页面上（返回的是页面元素，不在 Shadow Root 内）= 放行；落在搜索框、快捷入口、品牌等控件上 = 允许；落在 Shadow Root 内的其他元素上 = 被拦截
const stripHits = (page) => page.evaluate(() => {
  const root = document.getElementById('margin-watch-top').shadowRoot;
  const hit = [];
  for (let x = 4; x < innerWidth; x += 16) {
    const el = root.elementFromPoint(x, 35);
    if (el && root.contains(el) && !el.closest('.brand, .search, .et, .acts, .top-command, a, button, input')) hit.push(`${x}:${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
  }
  return hit;
});
const controlHit = (page, selector) => page.evaluate((selector) => {
  const root = document.getElementById('margin-watch-top').shadowRoot;
  const el = root.querySelector(selector); if (!el) return null;
  const r = el.getBoundingClientRect(), at = root.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!at && (el === at || el.contains(at));
}, selector);
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, weather: false, footprint: false, bg: { mode: 'off' }, theme: 'dark', autoWeb: false, wide: false } }));
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  for (const [kind, url] of [['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/'], ['search', 'https://search.bilibili.com/all?keyword=%E6%B5%8B%E8%AF%95']]) {
    await page.goto(url);
    await page.locator('#margin-watch-top .top').waitFor({ state: 'attached' });
    // 搜索页顶栏是 commandOnly 模式：没有搜索框，只有「命令」按钮
    await page.waitForFunction(() => ['search', 'top-command'].some((c) => (document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.' + c)?.getBoundingClientRect().width ?? 0) > 0));
    await page.evaluate(() => { const c = document.querySelector('#commentapp, bili-comments, .comment-container'); if (c) c.style.minHeight = '2400px'; });
    for (const scrollY of [0, 900]) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), scrollY); await page.waitForTimeout(250);
      const hits = await stripHits(page);
      assert.deepEqual(hits, [], `${kind} @${scrollY}: header strip must not intercept clicks, blocked x=${hits.slice(0, 6).join(',')}…`);
    }
    const controls = kind === 'search' ? ['.brand', '.top-command', '.acts .et-btn', '.acts .hd-settings'] : ['.brand', '.search', '.acts .et-btn', '.acts .hd-settings'];
    for (const sel of controls) {
      assert.equal(await controlHit(page, sel), true, `${kind}: ${sel} must still receive clicks`);
    }
    results.push(`${kind}: transparent header strip passes clicks through at any scroll position while its controls stay clickable`);
    await page.screenshot({ path: join(out, `${kind}-scrolled.png`), clip: { x: 0, y: 0, width: 1920, height: 160 } });
  }
  // 抽屉、悬浮菜单、滚动标尺是 .app.wt 的其他子元素，必须照常可用
  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
  await page.locator('#margin-watch-top .hd-settings').click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await page.locator('#margin-watch-top .sheet-layer[data-open="true"] .scrim').click({ position: { x: 200, y: 400 } });
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'hidden' });
  results.push('settings sheet opens from the header and closes from its scrim');
  assert.deepEqual(errors, []);
  results.forEach((result) => console.log('PASS ' + result));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
