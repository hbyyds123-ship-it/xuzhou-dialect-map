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

  /* ⑧ 方言点面板：从「读」变成「能用」
     旧版 20 个点里有 10 个连一个能点的东西都没有 —— 点开只能读完走人。
     断言四件事：引例词带动作、听这一带给出状态、小游戏写明是哪个区的、
     同类的点列出来。 */
  await page.goto(base + '#/s/peixian', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const sp = await page.evaluate(() => {
    const b = document.getElementById('panelBody');
    const heads = [...b.querySelectorAll('.p-sec h3')].map((h) => h.textContent.trim());
    const acts = [...b.querySelectorAll('.sq-btn')].map((x) => x.textContent.trim());
    const word = (b.querySelector('.spot-quote .q-w') || {}).textContent || '';
    return {
      heads, acts, word,
      bandBtn: !!(b.querySelector('.band-btn')),
      bandNone: (b.querySelector('.band-none') || {}).textContent || '',
      quizHead: heads.find((h) => h.indexOf('小游戏') >= 0) || '',
      kin: b.querySelectorAll('.p-sec .spot-row').length
    };
  });
  check('方言点面板有「听这一带」与「这地方的一个说法」',
    sp.heads.indexOf('听这一带') >= 0 && sp.heads.indexOf('这地方的一个说法') >= 0,
    '小节=' + JSON.stringify(sp.heads));
  check('引例词卡片带「看这个词 / ＋ 录一条」动作',
    sp.acts.some((a) => a.indexOf('看这个词') >= 0) && sp.acts.some((a) => a.indexOf('＋ 录一条') >= 0),
    JSON.stringify(sp.acts));
  check('没录音的词给合成兜底且说明清楚',
    sp.acts.some((a) => a.indexOf('听个大概') >= 0) && /合成/.test((await page.evaluate(() => (document.querySelector('.sq-note') || {}).textContent || ''))),
    JSON.stringify(sp.acts));
  check('没有真人录音时「听这一带」直说空白而不是假装有按钮',
    !sp.bandBtn && /还没有一条真人录音/.test(sp.bandNone) && /沛县/.test(sp.bandNone),
    sp.bandNone.slice(0, 60));
  check('引例词就是这条方言点的词', sp.word.indexOf('恁') >= 0, '词面=' + sp.word.trim());
  check('同类的其他点列出来了（曲艺/方言词各成线）', sp.kin >= 3, '同类行数=' + sp.kin);

  // 小游戏标题必须带区名：同一个区的点进去都是同一关，「方言小游戏」是谎话
  await page.goto(base + '#/s/qinshu', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const qh = await page.evaluate(() => {
    const b = document.getElementById('panelBody');
    return ([...b.querySelectorAll('.p-sec h3')].map((h) => h.textContent.trim()))
      .find((h) => h.indexOf('小游戏') >= 0) || '';
  });
  check('小游戏标题写明是哪个区的（不是这个点专属）', qh === '鼓楼区的小游戏', '标题=' + JSON.stringify(qh));

  /* ⑨ 「听这一带」连播：塞两条假录音 + 假 Audio，只测排队顺序与按钮状态 */
  await page.evaluate(() => {
    localStorage.setItem('xzdt.sample.v1', JSON.stringify({
      version: 1, updatedAt: Date.now(), count: 2,
      words: {
        lagua: { clipId: 'c1', saying: '拉呱', speaker: '奶奶', gen: 3, clips: [{ clipId: 'c1' }] },
        zir: { clipId: 'c2', saying: '恣儿', speaker: '爷爷', gen: 3, clips: [{ clipId: 'c2' }] }
      }
    }));
  });
  await page.goto(base + '?band=1#/s/qinshu', { waitUntil: 'load' });   // 换 URL 才会整页重载，索引才会重读
  await page.waitForTimeout(1200);
  const bandState = await page.evaluate(() => {
    const b = document.getElementById('hearBand');
    if (!b) return { err: '没有连播按钮' };
    window.__played = [];
    window.Audio = function (u) {
      const o = { u, paused: false };
      o.play = function () { window.__played.push(u); setTimeout(() => { if (o.onended) o.onended(); }, 120); return Promise.resolve(); };
      o.pause = function () { o.paused = true; };
      return o;
    };
    window.XZ.sample.urlFor = (id) => Promise.resolve('fake://' + id);
    b.click();
    return { clicked: true };
  });
  await page.waitForTimeout(700);
  const bandDone = await page.evaluate(() => {
    const b = document.getElementById('hearBand');
    return {
      played: (window.__played || []).slice(),
      end: b ? b.textContent.trim() : '',
      playing: b ? b.classList.contains('playing') : null
    };
  });
  check('有录音的区给「连着听」按钮且计数正确',
    bandState.clicked && /2 条/.test((await page.evaluate(() => (document.getElementById('hearBand') || { getAttribute: () => '' }).getAttribute('data-label') || ''))),
    JSON.stringify(bandState));
  /* 期望顺序 = 词表里这一区已录的词的顺序（app.js 就是这么取的，别按想象写死） */
  const expect = await page.evaluate(() =>
    window.ATLAS.words.filter((w) => ['lagua', 'zir'].indexOf(w.id) >= 0).map((w) => w.id));
  check('连播按词表顺序一条接一条且播完自动复位',
    bandDone.played.length === 2 && bandDone.played[0] === 'fake://' + expect[0] && bandDone.played[1] === 'fake://' + expect[1]
      && /▶ 连着听/.test(bandDone.end) && !bandDone.playing,
    JSON.stringify({ played: bandDone.played, expect }));
  // 播完后再点一轮，验证第二次能重新开始（不是一次性按钮）
  await page.evaluate(() => { document.getElementById('hearBand').click(); });
  await page.waitForTimeout(500);
  const replay = await page.evaluate(() => (window.__played || []).length);
  check('连播按钮可以反复点', replay >= 3, '第二轮已播=' + replay);

  // 清掉假录音，别污染后续/其他断言
  await page.evaluate(() => localStorage.removeItem('xzdt.sample.v1'));

  /* ⑩ 一关能不能真的走完
     此前这里是个真空：测试只验「进得去、退得出」，于是「下一题」从来没被点过 ——
     那个按钮连点击事件都没绑，第一题答完全世界就停在那里，而 CI 一直全绿。
     所以这一段必须真的答完一整关。 */
  await page.goto(base + '#/quiz/3', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  let steps = 0, firstAsk = null, secondAsk = null, blocked = false;
  for (let i = 0; i < 16; i++) {
    if (await page.$('.q-result')) break;
    const opt = await page.$('.q-opt:not([disabled])');
    if (!opt) { blocked = true; break; }
    /* 换不换题要看「这个词」本身；.q-ask 是固定问句，比它永远相等 */
    const askNow = await page.evaluate(() => {
      const q = document.querySelector('.q-word');
      return q ? q.textContent.trim() : '';
    });
    if (i === 0) firstAsk = askNow;
    await opt.click();
    await page.waitForTimeout(220);
    const nx = await page.$('[data-next]:not([hidden])');
    if (!nx) { blocked = true; break; }
    await nx.click();
    await page.waitForTimeout(320);
    if (i === 0) {
      secondAsk = await page.evaluate(() => {
        const q = document.querySelector('.q-word');
        return q ? q.textContent.trim() : '';
      });
    }
    steps++;
  }
  const fin = await page.evaluate(() => {
    const S = window.XZ.store.get();
    const done = (S.levels && S.levels.done) || {};
    return {
      result: !!document.querySelector('.q-result'),
      stars: (document.querySelectorAll('.qr-stars').length ? document.querySelector('.qr-stars').textContent : ''),
      doneKeys: Object.keys(done),
      value: S.value || 0,
      unlocked: window.XZ.selectors.bookProgress().unlocked
    };
  });
  check('答完第一题点「下一题」会换题', !!firstAsk && !!secondAsk && firstAsk !== secondAsk,
    `第一题「${firstAsk}」→ 第二题「${secondAsk}」`);
  check('一整关能走完并出结算页', !blocked && fin.result === true && steps >= 4,
    `步数=${steps} 卡住=${blocked} 结果页=${fin.result}`);
  check('走完一关会写进存档（通关记录 + 解锁词条）',
    fin.doneKeys.length > 0 && fin.unlocked > 0 && fin.value > 0,
    JSON.stringify(fin));

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
