#!/usr/bin/env node
/* ============================================================
   tools/new-volume.cjs — 生成「下一卷」的骨架
   ------------------------------------------------------------
   这个脚本存在的意义，是让"一卷一个地方"变成一条可执行命令，
   而不是 README 里的一句口号。

     npm run new-volume -- suqian 宿迁
     npm run new-volume -- "yangzhou" "扬州" "扬州话" 3

   产物：volumes/<id>/
     · volume.js   这一卷的元信息（标题、地名、方言名、印章字、卷号）
     · README.md   把这一卷做出来要准备什么：词表、边界、方言点、范本音、合规

   它**不**改仓库里任何现有文件，也**不**假装数据已经就位：
   骨架里没有一条编造的词。剩下的只能由人来做 —— 找发音人、查方言志。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'volumes');

function curVolume() {
  try {
    const sb = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data/volume.js'), 'utf8'), sb, { filename: 'volume.js' });
    return sb.window.VOLUME || {};
  } catch (e) { return {}; }
}

function usage() {
  console.log(`
用法：node tools/new-volume.cjs <卷 id> <地名> [方言名] [卷号]

  <卷 id>   小写字母开头，可含数字与连字符：suqian / lianyungang
  <地名>    用于「<地名>方言档案」：宿迁
  [方言名]  用于「这句<方言名>的意思是？」：宿迁话（默认 <地名>话）
  [卷号]    第几卷（默认取当前卷号 + 1）

例：
  node tools/new-volume.cjs suqian 宿迁
  node tools/new-volume.cjs yangzhou 扬州 扬州话 3
`);
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '-h' || argv[0] === '--help') { usage(); process.exit(argv.length ? 0 : 1); }

const [, , id, name, dialect, noArg] = ['', '', ...argv];
if (!id || !name) { usage(); process.exit(1); }
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`卷 id 不合规：「${id}」。要小写字母开头，只含小写字母、数字、连字符。`);
  process.exit(1);
}

const cur = curVolume();
const dialectName = dialect || (name + '话');
const no = Number(noArg) || (Number(cur.no) || 1) + 1;
const dir = path.join(OUT, id);

if (fs.existsSync(dir)) {
  console.error(`volumes/${id}/ 已存在，没有覆盖。要重来就先自己删掉它。`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const mark = name.slice(-1) === '州' ? '州' : name.slice(0, 1);

fs.writeFileSync(path.join(dir, 'volume.js'), `/* ============================================================
   volumes/${id}/volume.js — 第 ${no} 卷 · ${name}
   ------------------------------------------------------------
   这一卷的元信息。看完把它复制成 data/volume.js，就完成"换卷"的一大半。
   剩下的（词表、边界、方言点、范本音）见同目录的 README.md。

   字段含义与 data/volume.js 完全一致，别在这里发明新字段。
   ============================================================ */
window.VOLUME = {
  id: '${id}',
  no: ${no},
  title: '乡音册',
  name: '${name}',
  dialect: '${dialectName}',
  mark: '${mark}',
  scope: '',

  dataLicense: 'CC BY-SA 4.0',
  refsBy: '',
  survey: '',        // 例：《${name}方言志》（作者、出版社、年份）—— 有依据才写，没有就空着
  mapSource: '',     // 边界数据来源与审图号。公开上线必须有，本地演示可以先空

  note: '${name}是第 ${no} 卷。'
};
`, 'utf8');

fs.writeFileSync(path.join(dir, 'README.md'), `# 第 ${no} 卷 · ${name}

这一卷还是空的。**没有一个词是编的** —— 下面四样东西备齐之前，不要往 \`atlas.js\` 里填假数据。

## 一、要准备的

| 什么 | 放哪 | 规格 | 谁来做 |
|---|---|---|---|
| 词表 | \`data/atlas.js\` | 30–60 个词，字段见下表 | 查方言志 + 找当地人核 |
| 边界 | \`data/geo.${id}.js\` | GeoJSON，和 \`geo.xuzhou.js\` 同结构 | 用有审图号的标准底图 |
| 方言点 | \`data/atlas.js\` 的 \`spots\` | 10–20 处，带经纬度与类别 | 实地或地方志 |
| 范本音 | \`data/ref-audio/\` + \`npm run refs\` | 每个词一条，30 秒内 | 请 1–3 位发音人念 |
| 卷信息 | \`data/volume.js\` | 用同目录的 \`volume.js\` 覆盖 | 你 |

## 二、词条字段（照着 \`data/atlas.js\` 抄结构）

| 字段 | 含义 | 注意 |
|---|---|---|
| \`id\` | 拼音形式的稳定 id（\`guan\`） | 范本音文件按它命名，**定了就别改** |
| \`w\` | 词形（\`管\`） | 用本地通行写法 |
| \`py\` | 拼音/注音 | 声调怎么标要一以贯之 |
| \`meaning\` | 普通话释义 | 别写成网络流行语 |
| \`example\` | 一句本地例句 | 从真实对话里摘，不要造 |
| \`cat\` | 类别（见 \`wordCats\`） | 新增类别要同时加标签 |
| \`difficulty\` / \`levelId\` | 难度与关卡 | 决定闯关怎么排 |
| \`districtId\` / \`spotId\` | 归属区县与方言点 | 地图点选要靠它 |

## 三、换卷的四个动作

1. 把这里的 \`volume.js\` 复制成 \`data/volume.js\`；
2. 用你的词表替换 \`data/atlas.js\`（\`spots\`、\`levels\`、\`wordCats\` 一起改，不能只换 \`words\`）；
3. 换 \`data/geo.xuzhou.js\` 为 \`data/geo.${id}.js\`，并改 \`index.html\` 里那行 \`<script>\`；
4. 录音丢进 \`data/ref-audio/\`，跑 \`npm run refs\`。

跑一遍 \`node tools/audit-reachability.cjs\` 和 \`cd recorder && node tools/selftest.cjs\`，
确认没有词条拿不到、引擎没被数据带坏。

## 四、两句丑话说在前面

- **地图数据合规**：中国地图必须用有审图号的标准底图。自己描的边界本地做演示可以，
  一旦公开上线，边界不合规是硬风险，不是"做得像不像"的问题。
- **发音人同意**：录音前说清用途、会不会公开、能不能撤回。没有书面同意就不要收。
  人给了声音不等于把声音的所有权给了你。
`, 'utf8');

console.log(`
已生成：volumes/${id}/
  · volume.js   第 ${no} 卷 · ${name}（${dialectName}），印章字「${mark}」
  · README.md   要备的四样东西与词条字段表

下一步：
  1. 看 volumes/${id}/README.md；
  2. 备齐词表/边界/方言点/范本音；
  3. 把 volumes/${id}/volume.js 复制成 data/volume.js 完成换卷。

注：脚本只生成骨架，没有编造任何词条。这一卷能不能立住，取决于你找到的发音人。
`);
