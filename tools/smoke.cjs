#!/usr/bin/env node
'use strict';
/**
 * tools/smoke.cjs —— 浏览器冒烟（Playwright）
 *
 * 覆盖审计报告里「只有真跑起来才知道」的那几类问题：
 *   ① 5 个 hash 视图都能出 DOM
 *   ② 全程 console.error / pageerror = 0
 *   ③ 残缺存档不抛错，且历史脏档里的 levels.active 被清掉
 *   ④ 进关→退出后，区县不再永久「进行中」
 *   ⑤ 拉呱场景能走完、能解锁词条、能写 scenes.done
 *   ⑥ 图鉴分母 = atlas 词条总数
 *
 * 依赖：npm i -D playwright && npx playwright install chromium
 * 用法：node tools/smoke.cjs [--port=8711]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const portArg = process.argv.find((a) => a.startsWith('--port='));
const PORT = Number(portArg ? portArg.split('=')[1] : 8711) || 8711;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json'
};

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('404'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.on('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

const fails = [];
function check(name, ok, extra) {
  if (!ok) fails.push(name + (extra ? ' :: ' + extra : ''));
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra && !ok ? '  :: ' + extra : ''));
}

(async () => {
  let srv, browser;
  try {
    srv = await serve();
  } catch (e) {
    console.error('[smoke] 端口 ' + PORT + ' 起不来: ' + e.message);
    process.exit(2);
  }

  const { chromium } = require('playwright');
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const base = 'http://127.0.0.1:' + PORT + '/index.html';

  /* ① 视图 */
  for (const h of ['#/', '#/d/quanshan', '#/s/yanchuan', '#/w/guada', '#/quiz/2']) {
    await page.goto(base + h, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const len = await page.evaluate(() => (document.body.innerText || '').trim().length);
    check('视图非空 ' + h, len > 0, 'innerText 长度=' + len);
  }

  /* ② 控制台 */
  check('无 console.error / pageerror', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ③ 残缺存档 */
  const saves = [
    ['半截档·缺 seen', '{"version":2,"words":{"unlocked":["guan"]}}'],
    ['类型错误·words 非对象', '{"version":2,"words":"x"}'],
    ['类型错误·active 非数字', '{"version":2,"levels":{"active":"abc"}}'],
    ['脏档·上次中途退出 active=2', '{"version":2,"levels":{"active":2}}'],
    ['非法 JSON', '{"version":2,}']
  ];
  for (const [name, raw] of saves) {
    errors.length = 0;
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate((v) => { try { localStorage.setItem('xzdt.v2', v); } catch (e) {} }, raw);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      boot: window.XZ && window.XZ.store && window.XZ.store.bootMode,
      active: window.XZ && window.XZ.store.get().levels.active,
      yunlong: window.XZ && window.XZ.selectors.districtState('yunlong')
    }));
    check('残缺存档不抛错 · ' + name,
      errors.length === 0 && !!state.boot, errors[0] || ('boot=' + state.boot));
    check('脏 active 被清 · ' + name,
      state.active === 0 && state.yunlong !== 'playing',
      'active=' + state.active + ' yunlong=' + state.yunlong);
  }

  /* ④ 进关 → 退出 */
  await page.goto(base + '#/quiz/2', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const opened = await page.$('.q-close');
  if (opened) {
    await opened.click();
    await page.waitForTimeout(600);
  }
  const after = await page.evaluate(() => ({
    active: window.XZ.store.get().levels.active,
    yunlong: window.XZ.selectors.districtState('yunlong')
  }));
  check('退出答题后不残留 playing',
    after.active === 0 && after.yunlong !== 'playing',
    'active=' + after.active + ' yunlong=' + after.yunlong);

  /* ⑤ 拉呱场景端到端 */
  await page.goto(base + '#/scene/zaodian', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  let hasScene = await page.$('.sc-opt');
  if (!hasScene) {
    check('场景路由可进入 #/scene/zaodian', false, '没有 .sc-opt，检查 features/scene.js 是否已引入且 router 有 scene 分支');
  } else {
    check('场景路由可进入 #/scene/zaodian', true);
    for (let i = 0; i < 12; i++) {
      if (await page.$('.sc-done')) break;
      const opt = await page.$('.sc-opt:not([disabled])');
      if (opt) { await opt.click(); await page.waitForTimeout(150); }
      const nx = await page.$('.sc-next');
      if (nx) { await nx.click(); await page.waitForTimeout(150); }
    }
    const done = await page.evaluate(() => {
      var S = window.XZ.store.get();
      return {
        sceneDone: (S.scenes.done || []).indexOf('zaodian') >= 0,
        unlocked: window.XZ.selectors.bookProgress().unlocked,
        total: window.XZ.selectors.bookProgress().total
      };
    });
    check('场景走完并写入 scenes.done', done.sceneDone);
    check('场景解锁了词条', done.unlocked > 0, 'unlocked=' + done.unlocked);
    check('图鉴分母 = 词条总数', done.total === 54, 'total=' + done.total);
  }

  /* ⑦ 点开一个区，得看见「这个区的方言词」而不是只有文化地点 */
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const chip = await page.$('#districtBar .chip[data-name="鼓楼区"]');
  if (chip) {
    await chip.click();
    await page.waitForTimeout(800);
    const dp = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.word-row')];
      const heads = [...document.querySelectorAll('.p-sec h3')].map((h) => h.textContent.trim());
      const hero = document.querySelector('#panelBody .p-hero');
      const desc = [...document.querySelectorAll('.p-sec .p-desc')].map((p) => p.textContent.trim()).join(' ');
      return {
        heads,
        rows: rows.length,
        first: rows[0] ? rows[0].querySelector('.wr-w').textContent.trim() : '',
        firstHasAct: !!(rows[0] && rows[0].querySelector('.wr-act')),
        firstWord: rows[0] ? rows[0].getAttribute('data-word') : '',
        // 抬头不许再拿方言点缩略图当封面（沛县那张「汉」牌会把标题压住）
        heroHasImg: !!(hero && hero.querySelector('img')),
        heroPaper: !!(hero && hero.classList.contains('p-hero-paper')),
        hasMark: !!(hero && hero.querySelector('.ph-mark')),
        desc
      };
    });
    check('区县面板有「这个区的方言词」且每行带动作按钮',
      dp.heads.indexOf('这个区的方言词') >= 0 && dp.rows >= 5 && dp.firstHasAct,
      `小节=${JSON.stringify(dp.heads)} 词行=${dp.rows} 首词「${dp.first}」`);
    // 抬头是纸本（字水印 + 区名），不是某个方言点的缩略图铺满
    check('区县面板抬头是纸本（不再拿方言点缩略图当封面）',
      dp.heroPaper && dp.hasMark && !dp.heroHasImg,
      JSON.stringify({ heroPaper: dp.heroPaper, hasMark: dp.hasMark, heroHasImg: dp.heroHasImg }));
    // 只有两三个词的区（沛县 3、睢宁 2）必须说清这是抽样，否则像数据丢了
    check('区县面板说明这是抽样并给出全卷条数',
      /抽样/.test(dp.desc) && /全卷\s*54\s*条/.test(dp.desc),
      dp.desc.slice(0, 90));
    // 点词行应进词条视图
    if (dp.firstWord) {
      await page.click('.word-row .wr-w');   // 点词本身，别点到右边的 ＋录 链接
      await page.waitForTimeout(600);
      const hash = await page.evaluate(() => location.hash);
      // 路由实际是 #/w/<id>（不是 #/word/），别按想象中的格式断言
      check('区县面板点词行会进词条', /#\/w\/[^/]+$/.test(hash), 'hash=' + hash);
    }
  } else {
    check('区县面板有「这个区的方言词」且每行带动作按钮', false, '找不到 鼓楼区 的 chip');
  }

  await browser.close();
  srv.close();

  console.log('\n' + (fails.length
    ? '[smoke] FAIL —— ' + fails.length + ' 项未通过'
    : '[smoke] OK —— 全部断言通过'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('[smoke] 崩了: ' + (e && e.stack || e));
  process.exit(2);
});
