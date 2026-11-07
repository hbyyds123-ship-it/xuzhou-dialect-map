#!/usr/bin/env node
/**
 * 生成《乡音册 · 徐州卷 念稿单》——一张能打印、能交给发音人的纸。
 *
 *   node tools/make-sheet.cjs            生成 docs/念稿单-徐州.html 与 .pdf
 *   node tools/make-sheet.cjs --html-only  只出 HTML（没装 chromium 时用）
 *
 * 与 pack.html 里那个「打印念稿单」的区别：
 *   - pack.html 打的是**当前这一卷 / 当前筛选**，现场用；
 *   - 这个脚本打的是**整卷 54 条**，一次成型，能直接发给别人。
 * 两处的编号规则必须一致：编号 = 音频文件名里的数字（01、02…）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs');
const BASE = '念稿单-徐州';

/* ---------------- 读词表 ---------------- */

function loadAtlas() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data/atlas.js'), 'utf8'), sandbox);
  return sandbox.window.ATLAS;
}

/**
 * 按「片区 → 好念的先」重排编号。
 *
 * 为什么要重排：atlas 里的词是分批补进去的，同一个区县的词散在 01、34、53 三处。
 * 纸是要给老人照着一页页念的，编号连着走才不会让人以为漏了。
 * 编号不写进任何数据，只在「这一份纸 + 这一批音频」之间起作用，所以重排是安全的。
 */
function buildRows(atlas) {
  const order = atlas.districts.map((d) => d.id);
  const byDistrict = {};
  atlas.words.forEach((w) => {
    (byDistrict[w.districtId] = byDistrict[w.districtId] || []).push(w);
  });

  const rows = [];
  const sections = [];
  order.forEach((id) => {
    const list = (byDistrict[id] || []).slice().sort((a, b) => {
      return (a.difficulty || 9) - (b.difficulty || 9);
    });
    if (!list.length) return;
    const d = atlas.districts.find((x) => x.id === id);
    const start = rows.length + 1;
    list.forEach((w) => {
      rows.push(Object.assign({}, w, { no: rows.length + 1, districtName: d.name }));
    });
    sections.push({ id, name: d.name, from: start, to: rows.length, count: list.length });
  });

  return { rows, sections };
}

/* ---------------- HTML ---------------- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/**
 * 词条 id → [普通话里的说法, 普通话例句]
 *
 * 为什么要有这一层：这张纸不是只给徐州人念的。如果条目直接写「管」「恣儿」，
 * 外地人不知道在问什么，也没法答 —— 只有普通话的寻常词，才能拿去问任何一个县、
 * 任何一个村：「这个话，你们那儿怎么说？」方言说法退成一行灰字，当作已经答过的样板。
 */
const GLOSS = {
  guan: ['行', '这事行不行？'],
  zir: ['舒服', '今天玩得真舒服。'],
  lagua: ['聊天', '咱俩在这儿聊会儿天。'],
  shangwu: ['中午', '中午吃的什么？'],
  bai: ['别', '你别动那个，挺贵的。'],
  yelai: ['昨天', '昨天下了一场大雨。'],
  ganming: ['明天', '明天再去你家。'],
  jiazou: ['回家', '天黑了，回家吧。'],
  gengen: ['旁边', '在百货大楼旁边等你。'],
  renn: ['到处', '东西到处都找不着。'],
  daocai: ['夹菜', '来来来，别客气，夹菜！'],
  hutu: ['玉米面粥', '早上喝碗玉米面粥，顶饱。'],
  yangshi: ['西红柿', '西红柿炒鸡蛋最下饭。'],
  maozi: ['厕所', '问一声厕所在哪儿。'],
  wudang: ['屋子中间', '别站在屋子中间挡着道。'],
  cimao: ['差劲', '这东西太差劲了。'],
  dabashou: ['帮忙', '来帮个忙，抬一下桌子。'],
  deyouyi: ['故意', '他故意这么干的。'],
  mazhan: ['马上', '你等会儿，马上就来。'],
  haile: ['多得很', '赶集的人多得很。'],
  tingting: ['蜻蜓', '河边蜻蜓飞得低。'],
  shounie: ['手帕', '擦擦汗，给你手帕。'],
  jueya: ['脚', '脚冻得没知觉了。'],
  gebai: ['膝盖', '摔了一跤，磕着膝盖了。'],
  maoge: ['硬币', '兜里就剩两个硬币。'],
  shenme: ['什么东西', '你说的什么东西？'],
  mashang: ['一会儿', '你坐那儿，一会儿就好。'],
  genala: ['在哪儿', '百货大楼在哪儿？'],
  tiliu: ['很圆', '这馒头蒸得很圆。'],
  yangxin: ['得意', '看他那得意的劲儿。'],
  yerang: ['挨骂', '作业没写，挨了一顿骂。'],
  samo: ['张望', '你张望张望，人来了没？'],
  mazhua: ['手忙脚乱', '一听要考试，他立马手忙脚乱。'],
  kechen: ['难看', '这衣裳穿出去有点难看。'],
  deji: ['管用', '这药真管用，喝两回就好了。'],
  laobizi: ['非常多', '夜市上东西非常多。'],
  yibengzi: ['一阵子', '等了一阵子他才来。'],
  yizi: ['肥皂', '拿块肥皂把手洗洗。'],
  shiduo: ['收拾', '把屋里收拾收拾，来客了。'],
  waini: ['糟了', '这下糟了，钥匙锁屋里了。'],
  zhagu: ['治病', '赶紧去医院治治。'],
  hulielie: ['胡说', '你别胡说，没那回事。'],
  gudao: ['摆弄', '一上午就摆弄那个收音机。'],
  zoume: ['干什么', '你干什么去？这么急。'],
  nen: ['你们', '你们都来了？快坐。'],
  an: ['我们', '我们家就在这条街上。'],
  guada: ['闲聊', '他俩在门口闲聊半天了。'],
  xihan: ['喜欢', '奶奶最喜欢这小孙子。'],
  bandiaozi: ['不靠谱', '他是个不靠谱的，别指望他。'],
  babuneng: ['巴不得', '巴不得早点下班回家。'],
  puleng: ['扑腾', '鱼在盆里直扑腾。'],
  xiexie: ['很', '今天很冷，多穿点。'],
  ladao: ['算了', '算了，别争了。'],
  shidehuang: ['累', '走了一天，累。']
};

/** 没有对照的词（用户自己开的卷）就退回词条自带的释义与例句 */
function glossOf(w) {
  const g = GLOSS[w.id];
  if (g) return g;
  const m = String(w.meaning || '').split(/[、，,；;]/)[0].trim();
  return [m || w.w, w.example || ''];
}

function renderHtml(atlas, rows, sections) {
  const total = rows.length;

  const how = [
    ['一条录一段', '按 01、02 的顺序来。念完一条停一下，再按停录音。'],
    ['怎么念', '看左边「问的是」那个普通话词，用家乡话说出它；再用家乡话把右边那句例句说一遍。<b>不是念普通话，是念你们那儿的话</b>。'],
    ['不会就跳过', '你那儿不这么说、或者没这东西，直接跳，在「念过」划一道。<b>空着比编一条有用</b>。'],
    ['用什么录', '手机自带的录音机就行，不用装软件。找个安静屋子，嘴离手机一拃远。'],
    ['念多少', '一次念 20 条左右，分两三次录完也行，<b>编号别断</b>。'],
    ['怎么发回来', '微信发<b>「文件」</b>，别发语音消息 —— 语音消息存不下来，也没法导进软件。']
  ].map((r) => (
    '<div class="h-item"><span class="h-k">' + esc(r[0]) + '</span>' +
    '<span class="h-v">' + r[1] + '</span></div>'
  )).join('');

  const sectionBlocks = sections.map((s) => {
    const list = rows.filter((r) => r.no >= s.from && r.no <= s.to);
    const body = list.map((w) => {
      const g = glossOf(w);
      return '<tr>' +
        '<td class="c-no">' + pad2(w.no) + '</td>' +
        '<td class="c-q"><b>' + esc(g[0]) + '</b>' +
          '<i>徐州：' + esc(w.w) + (w.py ? ' ' + esc(w.py) : '') + '</i></td>' +
        '<td class="c-e">' + esc(g[1]) + '</td>' +
        '<td class="c-ask"><span class="line"></span></td>' +
        '<td class="c-ck"><span class="box"></span></td>' +
        '</tr>';
    }).join('');

    return (
      '<section class="blk">' +
      '<h2 class="blk-h"><span class="blk-name">' + esc(s.name) + '</span>' +
      '<span class="blk-range">' + pad2(s.from) + '–' + pad2(s.to) +
      ' · ' + s.count + ' 条</span></h2>' +
      '<table class="sheet">' +
      '<thead><tr><th class="c-no">编号</th><th class="c-q">问的是（普通话）</th>' +
      '<th class="c-e">例句（用家乡话说一遍）</th>' +
      '<th class="c-ask">你家怎么说</th>' +
      '<th class="c-ck">念过</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      '</section>'
    );
  }).join('');

  return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">' +
'<title>念稿单 · 徐州卷 · 乡音册</title>\n<style>\n' + CSS + '</style></head>\n<body>\n' +

'<header class="cover">' +
  '<div class="cov-top"><span class="eyebrow">乡音册 · 第 1 卷 · 徐州</span>' +
    '<span class="cov-tag">念稿单</span></div>' +
  '<h1>普通话问一句，<br>家乡话答一句。</h1>' +
  '<p class="lede">这张纸上 <b>' + total + '</b> 个说法，全是普通话里的寻常话 —— 聊天、中午、昨天。' +
    '左边是「问什么」，右边那条线留给<b>你们那儿怎么说</b>。徐州先答了一遍（灰字），' +
    '换一个县、一个村，答法就换一套 —— 这一卷只是开了个头。</p>' +

  '<section class="how"><h3>怎么念</h3><div class="how-list">' + how + '</div></section>' +

  '<div class="cov-note">' +
    '<div class="n-line"><b>音频格式</b>：mp3、m4a、wav、aac、ogg 都收。' +
      '手机录音机出来的一般是 m4a，<b>不用转格式，也不用改名</b> —— 软件按文件名里的数字对（01、02…），' +
      '「新录音 1」「录音_02」也认。整批实在对不上时会按录音先后顺序对，导入时会明确告诉你是按顺序对的。</div>' +
  '</div>' +
'</header>' +

'<div class="pb"></div>' +

'<main class="sheets">' + sectionBlocks + '</main>' +

'<section class="tail">' +
  '<h2>录完了，这几样一起给回来</h2>' +
  '<ol>' +
    '<li>音频 —— 一堆文件直接发，或者压成一个包。</li>' +
    '<li>这张纸 —— 念过的打个勾，跳过的划一道。「你家怎么说」那栏写了最好，没写也不耽误。</li>' +
    '<li>一句话授权 —— 同意这段录音用在《乡音册》里，署名叫 <span class="u"></span>。</li>' +
  '</ol>' +
  '<div class="tail-note">' +
    '录音只存在收录音的那台电脑上，不上传、不联网；导进软件以后，' +
    '这一卷里那 ' + total + ' 条就都有了真人说法，点一下能听。' +
  '</div>' +
  '<div class="tail-fine">' +
    '这张纸问的是普通话，答的是家乡话 —— 徐州这 ' + total + ' 条，不过是先答过的那一遍。' +
    '你拿它去问自己的老家，答出来的就是第 2 卷、第 3 卷。' +
    '在软件里开一卷，「语言包」页会按你那一卷的词生成同样的问法表 —— 纸能换，问法一样。' +
  '</div>' +
'</section>' +

'</body></html>\n';
}

const CSS = `
@page { size: A4; margin: 14mm 13mm 12mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0; background: #f7f3ea; color: #2b2620;
  font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif;
  font-size: 12pt; line-height: 1.6;
}
b { font-weight: 600; }
.pb { page-break-after: always; height: 0; }

/* ---- 封面/说明页 ---- */
.cover { padding: 0 0 4mm; }
.cov-top { display: flex; align-items: baseline; justify-content: space-between;
  border-bottom: 2px solid #8f2f27; padding-bottom: 4mm; }
.eyebrow { font-size: 9.5pt; letter-spacing: .18em; color: #8f2f27; }
.cov-tag { font-size: 9.5pt; letter-spacing: .3em; color: #6b6157; }
h1 { font-size: 27pt; line-height: 1.35; font-weight: 600; letter-spacing: .04em;
  margin: 9mm 0 4mm; }
.lede { font-size: 11pt; color: #4a423a; margin: 0 0 8mm; max-width: 150mm; }
.lede b { color: #8f2f27; }

.cov-grid { display: grid; grid-template-columns: 1fr 1.15fr; gap: 9mm; }
.cov-col h3 { font-size: 10pt; letter-spacing: .16em; color: #8f2f27; font-weight: 600;
  margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #d8cfbe; }

/* 「怎么念」六格：两列，每格上标签下正文 */
.how { margin: 0 0 7mm; }
.how h3 { font-size: 10pt; letter-spacing: .16em; color: #8f2f27; font-weight: 600;
  margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #d8cfbe; }
.how-list { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 9mm; }
.h-item { padding-top: 2mm; border-top: 1px solid #e2d9c8;
  page-break-inside: avoid; }
.h-k { display: block; font-size: 9.5pt; color: #8f2f27; letter-spacing: .06em;
  margin-bottom: 1mm; }
.h-v { display: block; font-size: 10.5pt; line-height: 1.75; }

.cov-note { margin-top: 8mm; padding: 4mm 5mm; background: #f0e9db;
  border-left: 3px solid #8f2f27; }
.n-line { font-size: 10pt; line-height: 1.85; }
.n-line + .n-line { margin-top: 2mm; }
.n-line b { color: #8f2f27; }

/* ---- 词表 ---- */
.sheets { }
.blk { page-break-inside: auto; margin: 0 0 6mm; }
.blk-h { display: flex; align-items: baseline; justify-content: space-between;
  margin: 0 0 2mm; padding-bottom: 1.5mm; border-bottom: 2px solid #2b2620;
  page-break-after: avoid; }
.blk-name { font-size: 14pt; font-weight: 600; letter-spacing: .1em; }
.blk-range { font-family: Consolas, "Courier New", monospace; font-size: 9pt;
  letter-spacing: .08em; color: #6b6157; }

table.sheet { width: 100%; border-collapse: collapse; }
table.sheet th { font-size: 8.5pt; font-weight: 400; letter-spacing: .12em; color: #6b6157;
  text-align: left; padding: 0 2mm 1.2mm; border-bottom: 1px solid #b9ae9a; }
table.sheet td { padding: 1.8mm 2mm; border-bottom: 1px dotted #d3c9b6; vertical-align: baseline; }
table.sheet tr { page-break-inside: avoid; }

.c-no { width: 12mm; font-family: Consolas, "Courier New", monospace; font-size: 11pt;
  color: #8f2f27; letter-spacing: .04em; }
.c-q { width: 42mm; }
.c-q b { font-size: 15pt; letter-spacing: .02em; }
.c-q i { display: block; font-style: normal; font-size: 8.5pt; color: #7a7065;
  letter-spacing: .04em; margin-top: .6mm; }
.c-e { width: 64mm; font-size: 10.5pt; color: #4a423a; }
.c-ask { width: 46mm; }
.c-ask .line { display: block; height: 5.6mm; border-bottom: 1px dotted #b0a48e; }
.c-ck { width: 12mm; text-align: center; }
.box { display: inline-block; width: 5.2mm; height: 5.2mm; border: 1px solid #9a9082; }

/* ---- 尾页 ---- */
.tail { page-break-before: always; padding-top: 2mm; }
.tail h2 { font-size: 15pt; font-weight: 600; letter-spacing: .08em;
  margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid #8f2f27; }
.tail ol { margin: 0; padding-left: 5mm; }
.tail li { font-size: 11pt; margin-bottom: 2.5mm; }
.u { display: inline-block; width: 32mm; border-bottom: 1px solid #6b6157; }
.tail-note { margin-top: 6mm; padding: 3.5mm 4mm; background: #f0e9db; font-size: 10pt; line-height: 1.85; }
.tail-fine { margin-top: 5mm; font-size: 9.5pt; color: #6b6157; line-height: 1.8; }
`;

/* ---------------- 主流程 ---------------- */

async function main() {
  const htmlOnly = process.argv.includes('--html-only');
  const atlas = loadAtlas();
  const { rows, sections } = buildRows(atlas);
  const html = renderHtml(atlas, rows, sections);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, BASE + '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('HTML: ' + htmlPath + '  (' + rows.length + ' 条 / ' + sections.length + ' 片区)');

  if (htmlOnly) return;

  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) {
    console.log('没有 playwright，跳过 PDF：' + e.message);
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  const pdfPath = path.join(OUT_DIR, BASE + '.pdf');
  await page.pdf({
    path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:7pt;color:#8a8074;width:100%;padding:0 13mm;' +
      'display:flex;justify-content:space-between;font-family:SimSun,serif;">' +
      '<span>乡音册 · 徐州卷 · 念稿单</span>' +
      '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
  });
  await browser.close();
  const size = fs.statSync(pdfPath).size;
  console.log('PDF : ' + pdfPath + '  (' + (size / 1024 / 1024).toFixed(2) + ' MB)');
}

main().catch((e) => { console.error(e); process.exit(1); });
