# 第 2 卷 · 宿迁

这一卷还是空的。**没有一个词是编的** —— 下面四样东西备齐之前，不要往 `atlas.js` 里填假数据。

## 一、要准备的

| 什么 | 放哪 | 规格 | 谁来做 |
|---|---|---|---|
| 词表 | `data/atlas.js` | 30–60 个词，字段见下表 | 查方言志 + 找当地人核 |
| 边界 | `data/geo.suqian.js` | GeoJSON，和 `geo.xuzhou.js` 同结构 | 用有审图号的标准底图 |
| 方言点 | `data/atlas.js` 的 `spots` | 10–20 处，带经纬度与类别 | 实地或地方志 |
| 范本音 | `data/ref-audio/` + `npm run refs` | 每个词一条，30 秒内 | 请 1–3 位发音人念 |
| 卷信息 | `data/volume.js` | 用同目录的 `volume.js` 覆盖 | 你 |

## 二、词条字段（照着 `data/atlas.js` 抄结构）

| 字段 | 含义 | 注意 |
|---|---|---|
| `id` | 拼音形式的稳定 id（`guan`） | 范本音文件按它命名，**定了就别改** |
| `w` | 词形（`管`） | 用本地通行写法 |
| `py` | 拼音/注音 | 声调怎么标要一以贯之 |
| `meaning` | 普通话释义 | 别写成网络流行语 |
| `example` | 一句本地例句 | 从真实对话里摘，不要造 |
| `cat` | 类别（见 `wordCats`） | 新增类别要同时加标签 |
| `difficulty` / `levelId` | 难度与关卡 | 决定闯关怎么排 |
| `districtId` / `spotId` | 归属区县与方言点 | 地图点选要靠它 |

## 三、换卷的四个动作

1. 把这里的 `volume.js` 复制成 `data/volume.js`；
2. 用你的词表替换 `data/atlas.js`（`spots`、`levels`、`wordCats` 一起改，不能只换 `words`）；
3. 换 `data/geo.xuzhou.js` 为 `data/geo.suqian.js`，并改 `index.html` 里那行 `<script>`；
4. 录音丢进 `data/ref-audio/`，跑 `npm run refs`。

跑一遍 `node tools/audit-reachability.cjs` 和 `cd recorder && node tools/selftest.cjs`，
确认没有词条拿不到、引擎没被数据带坏。

## 四、两句丑话说在前面

- **地图数据合规**：中国地图必须用有审图号的标准底图。自己描的边界本地做演示可以，
  一旦公开上线，边界不合规是硬风险，不是"做得像不像"的问题。
- **发音人同意**：录音前说清用途、会不会公开、能不能撤回。没有书面同意就不要收。
  人给了声音不等于把声音的所有权给了你。
