/* ============================================================
   《乡音册》— 统一数据源（v2）
   ------------------------------------------------------------
   本文件是两个项目的唯一真源：
     · 3D 方言地图（区县 / 方言点）
     · 方言小游戏（词条 / 关卡 / 拉呱场景 / 等级）
   地图、搜索、详情卡、小游戏全部从 window.ATLAS 读取。
   体积考虑：区县边界单独放在 data/geo.xuzhou.js。
   ============================================================ */
window.ATLAS = {
  version: 2,
  meta: {
    title: '乡音册',
    subtitle: '徐州方言数字交互地图',
    project: 'XZDialectGame',
    updated: '2026-10-18',
    region: '江苏省徐州市',
    dialect: '中原官话 · 徐淮片'
  },

  /* ---------------- 方言点类型（决定 pin 颜色与图标） ---------------- */
  spotCategories: {
    quyi:    { label: '曲艺',   color: '#e8b54b', icon: 'note' },
    xiqu:    { label: '戏曲',   color: '#de5b48', icon: 'mask' },
    wenxian: { label: '文献',   color: '#6fa8c7', icon: 'book' },
    yanjiu:  { label: '研究',   color: '#9b8be0', icon: 'wave' },
    fayin:   { label: '发音人', color: '#4fc3a1', icon: 'mic' },
    huodong: { label: '活动',   color: '#e879a6', icon: 'star' },
    ciyu:    { label: '方言词', color: '#c9a063', icon: 'chat' }
  },

  /* ---------------- 词条分类（决定图鉴分组） ---------------- */
  wordCats: {
    changyong: { label: '常用', color: '#e8b54b' },
    shenghuo:  { label: '生活', color: '#6fa8c7' },
    yinshi:    { label: '饮食', color: '#de5b48' },
    liyu:      { label: '俚语', color: '#9b8be0' },
    gaoshou:   { label: '高手', color: '#4fc3a1' },
    lagua:     { label: '拉呱', color: '#e879a6' }
  },

  /* ---------------- 区县 ---------------- */
  districts: [
    { id: 'gulou',    name: '鼓楼区', adcode: '320302', type: '市辖区', note: '老城原声',
      intro: '徐州老城核心，彭城路、淮海路一带。徐州话的“标准音”主要取自这里的老人说法。',
      label: [117.2014, 34.3042], stage: 1 },
    { id: 'yunlong',  name: '云龙区', adcode: '320303', type: '市辖区', note: '戏窝子',
      intro: '云龙湖、户部山下，柳琴戏与徐州琴书最常响起的城区。',
      label: [117.2750, 34.2063], stage: 2 },
    { id: 'jiawang',  name: '贾汪区', adcode: '320305', type: '市辖区', note: '煤城杂音',
      intro: '百年煤城。矿区人口流动大，街市上南腔北调，与本地话长期交融。',
      label: [117.4385, 34.3965], stage: 4 },
    { id: 'quanshan', name: '泉山区', adcode: '320311', type: '市辖区', note: '学术重镇',
      intro: '中国矿大、江苏师大所在，方言调查与传承活动最密集的一片。',
      label: [117.1488, 34.2466], stage: 0 },
    { id: 'tongshan', name: '铜山区', adcode: '320312', type: '市辖区', note: '环城样本',
      intro: '环抱主城，旧铜山县。方言田野调查的重要样本区，乡镇之间差异明显。',
      label: [117.5051, 34.1975], stage: 3 },
    { id: 'fengxian', name: '丰县',   adcode: '320321', type: '县', note: '四省通衢',
      intro: '苏鲁豫皖四省交界，丰县琴书自成一脉，说唱全用本县方言。',
      label: [116.5491, 34.7460], stage: 0 },
    { id: 'peixian',  name: '沛县',   adcode: '320322', type: '县', note: '汉风古音',
      intro: '刘邦故里，汉风浓郁。口音厚实，老派说法保留得多。',
      label: [116.8886, 34.6748], stage: 0 },
    { id: 'suining',  name: '睢宁县', adcode: '320324', type: '县', note: '童画乡音',
      intro: '儿童画之乡，也是方言保护的先行县，系统采录六类语音资料。',
      label: [117.8769, 33.9850], stage: 0 },
    { id: 'xinyi',    name: '新沂市', adcode: '320381', type: '县级市', note: '苏鲁交界',
      intro: '骆马湖畔，地处苏鲁交界，口音带明显的过渡色彩。',
      label: [118.3411, 34.2669], stage: 0 },
    { id: 'pizhou',   name: '邳州市', adcode: '320382', type: '县级市', note: '银杏之乡',
      intro: '银杏之乡。徐淮片内部过渡的代表点，调值与市区略有出入。',
      label: [117.8859, 34.3618], stage: 5 }
  ],

  /* ---------------- 方言点 ---------------- */
  spots: [
    { id: 'qinshu', name: '徐州琴书', districtId: 'gulou', category: 'quyi',
      lnglat: [117.196, 34.288], thumb: 'assets/thumbs/qinshu.svg',
      tag: '国家级非遗 · Ⅴ-73',
      desc: '以徐州方言演唱、扬琴伴奏的说唱艺术，流行于苏鲁豫皖四省接壤地区。2008 年列入第二批国家级非物质文化遗产名录（编号 Ⅴ-73）。唱腔离不开徐州话的声调，一换普通话就散了味。',
      wordIds: ['lagua'],
      links: [{ label: '中国非物质文化遗产网', url: 'https://www.ihchina.cn/project_details/13706/' }] },

    { id: 'shisanyun', name: '徐州十三韵', districtId: 'gulou', category: 'wenxian',
      lnglat: [117.214, 34.272], thumb: 'assets/thumbs/shisanyun.svg',
      tag: '清代方言韵书',
      desc: '清代徐州方言韵书，又名《字海直音》，徐州西关南菜园同德善堂石印本。它把徐州音系按韵部归并，是今天回看老徐州话最直接的一手材料。',
      wordIds: ['yelai'],
      links: [{ label: 'CNKI 工具书库', url: 'https://wiki.cnki.com.cn' }] },

    { id: 'liuqinxi', name: '徐州柳琴戏', districtId: 'yunlong', category: 'xiqu',
      lnglat: [117.264, 34.238], thumb: 'assets/thumbs/liuqinxi.svg',
      tag: '国家级非遗 · 拉魂腔',
      desc: '唱词用徐州本地方言，以“拉魂腔”闻名，2008 年列入国家级非物质文化遗产扩展项目名录。一句拖腔能把人唱得心里发颤，靠的正是方言里的那股劲。',
      wordIds: ['zir'],
      links: [{ label: '中国非物质文化遗产网', url: 'https://www.ihchina.cn/' }] },

    { id: 'songdu', name: '“徐韵彭城”方言朗诵赛', districtId: 'yunlong', category: 'huodong',
      lnglat: [117.242, 34.262], thumb: 'assets/thumbs/songdu.svg',
      tag: '徐州工程学院 · 2025',
      desc: '徐州工程学院图书馆 2025 年举办，让年轻人用乡音读诗、读文。比赛不考发音标准度，考的是那股说得出口的熟稔。',
      wordIds: ['xiexie'],
      links: [{ label: '徐州工程学院图书馆', url: 'https://lib.xzit.edu.cn' }] },

    { id: 'cidian', name: '徐州方言词典', districtId: 'quanshan', category: 'wenxian',
      lnglat: [117.148, 34.256], thumb: 'assets/thumbs/cidian.svg',
      tag: '苏晓青 · 吕永卫 编纂',
      desc: '以徐州市区老派说法为标准，收录大量方言词条。查徐州话，绕不开这本。释义之外，例句大多来自真实口语记录。',
      wordIds: ['mazhua'],
      links: [{ label: 'Internet Archive', url: 'https://archive.org' }] },

    { id: 'yanchuan', name: '徐淮言传情，彭城声入心', districtId: 'quanshan', category: 'huodong',
      lnglat: [117.168, 34.232], thumb: 'assets/thumbs/yanchuan.svg',
      tag: '中国矿业大学 · 2025',
      desc: '中国矿业大学公共管理学院 2025 年举办的方言传承活动，线上打卡加敬老院慰问。老人说、学生记，把话从嘴边捞回来。',
      wordIds: ['guada'],
      links: [{ label: '中国矿业大学公共管理学院', url: 'https://cllp.cumt.edu.cn' }] },

    { id: 'jiawang', name: '贾汪矿区方言点', districtId: 'jiawang', category: 'ciyu',
      lnglat: [117.452, 34.436], thumb: 'assets/thumbs/jiawang.svg',
      tag: '煤城街市 · 南腔北调',
      desc: '贾汪挖了上百年煤，矿工来自四面八方。街市上徐州话、山东话、河南话混着说，久而久之长出一层带“杂味”的本地腔。',
      wordIds: ['deji'],
      links: [{ label: '江苏省公共图书馆联合目录', url: 'http://primo.clcn.net.cn' }] },

    { id: 'huibian', name: '江苏语言资源汇编·徐州卷', districtId: 'jiawang', category: 'wenxian',
      lnglat: [117.418, 34.404], thumb: 'assets/thumbs/huibian.svg',
      tag: '凤凰出版社 · 2015',
      desc: '针对江苏省 13 个大市的方言调查资料汇编，第三册为徐州卷。每个调查点都有固定字表、词表和语法例句，横向可比。',
      wordIds: ['laobizi'],
      links: [{ label: '江苏省公共图书馆联合目录', url: 'http://primo.clcn.net.cn' }] },

    { id: 'map3d', name: '方言 3D 语言地图研究', districtId: 'tongshan', category: 'yanjiu',
      lnglat: [117.196, 34.176], thumb: 'assets/thumbs/map3d.svg',
      tag: '日本科研费 · 19K20786',
      desc: '以徐州（旧铜山县）182 位发音人为对象，绘制地域差与世代差的 3D 语言地图。同一句话，老人和年轻人说出来的形状不一样——这张地图正是本页的灵感来源。',
      wordIds: ['an'],
      links: [{ label: 'KAKEN 科研费数据库', url: 'https://kaken.nii.ac.jp' }] },

    { id: 'tianshan', name: '铜山方言田野考察', districtId: 'tongshan', category: 'yanjiu',
      lnglat: [117.118, 34.128], thumb: 'assets/thumbs/tianshan.svg',
      tag: '学位论文 · 乡镇样本',
      desc: '系统考察徐州方言的声母、韵母、声调特征，词汇分类、语法结构及民俗语言。跑遍各乡镇，一个村一个村地记音。',
      wordIds: ['samo'],
      links: [{ label: '中国知网 · 学位论文', url: 'https://wap.cnki.net/touch/web/Dissertation/List/1015967763.nh.html' }] },

    { id: 'fengxian', name: '丰县琴书', districtId: 'fengxian', category: 'quyi',
      lnglat: [116.598, 34.702], thumb: 'assets/thumbs/fengxian.svg',
      tag: '国家级非遗 · 徐州琴书',
      desc: '徐州琴书的重要组成部分，说唱以丰县方言表述，2008 年入选第二批国家级非遗名录。同一段书，丰县口音唱出来比市区更“坠”。',
      wordIds: ['zoume'],
      links: [{ label: '百度百科 · 丰县', url: 'https://wapbaike.baidu.com/item/丰县/1438443' }] },

    { id: 'fengyin', name: '丰县方言发音人', districtId: 'fengxian', category: 'fayin',
      lnglat: [116.556, 34.664], thumb: 'assets/thumbs/fengyin.svg',
      tag: '中国语言资源有声数据库',
      desc: '徐州市语委面向社会征召方言发音人，录音录入中国语言资源有声数据库永久保存。要求是“土生土长、没离开过本地”的老住户。',
      wordIds: ['bai'],
      links: [{ label: '中国新闻网 · 报道', url: 'http://www.chinanews.com.cn/cul/2010/11-01/2626683.shtml' }] },

    { id: 'peixian', name: '沛县汉风口音', districtId: 'peixian', category: 'ciyu',
      lnglat: [116.938, 34.736], thumb: 'assets/thumbs/peixian.svg',
      tag: '刘邦故里 · 古音余韵',
      desc: '沛县是汉高祖刘邦故里，汉风浓。口音比市区更厚实，老派说法保留得多，一些词连徐州城里人都要愣一下才反应过来。',
      wordIds: ['nen'],
      links: [{ label: '中国新闻网 · 报道', url: 'http://www.chinanews.com.cn/cul/2010/11-01/2626683.shtml' }] },

    { id: 'huiting', name: '慧听徐州话语音库', districtId: 'peixian', category: 'fayin',
      lnglat: [116.892, 34.668], thumb: 'assets/thumbs/huiting.svg',
      tag: '829 人 · 492 小时',
      desc: '采集 829 人语音数据、总时长 492 小时，覆盖徐州市区及各县（市），可用于语音识别训练与方言研究。方言要活在机器里，先得有人把它说出来。',
      wordIds: ['yibengzi'],
      links: [{ label: '慧听科技 · 数据说明', url: 'http://huitingtech.com/dataInfo.action?id=10014' }] },

    { id: 'suining', name: '睢宁县方言保护计划', districtId: 'suining', category: 'huodong',
      lnglat: [117.948, 33.912], thumb: 'assets/thumbs/suining.svg',
      tag: '睢宁县文化馆 · 2023',
      desc: '2023 年由睢宁县文化馆启动，系统性征集日常生活用语、谚语歌谣、行业术语、戏曲说唱等六类语音资料。把“要消失的话”先录下来。',
      wordIds: ['shiduo'],
      links: [{ label: '睢宁县文化馆', url: 'https://www.snwhg.com/990.html' }] },

    { id: 'tongyao', name: '睢宁方言童谣', districtId: 'suining', category: 'ciyu',
      lnglat: [118.006, 33.964], thumb: 'assets/thumbs/tongyao.svg',
      tag: '儿童画之乡的乡音',
      desc: '睢宁是“儿童画之乡”，孩子们画得出五颜六色的乡村，也念得出奶奶教的童谣。童谣是方言最容易活下来的地方——因为它好玩。',
      wordIds: ['xihan'],
      links: [{ label: '睢宁县文化馆', url: 'https://www.snwhg.com/990.html' }] },

    { id: 'xinyi', name: '新沂骆马湖点', districtId: 'xinyi', category: 'ciyu',
      lnglat: [118.352, 34.374], thumb: 'assets/thumbs/xinyi.svg',
      tag: '苏鲁交界的过渡腔',
      desc: '新沂在江苏最北端，往北一步就是山东。骆马湖边的人说话，声调上介于徐州和临沂之间，是观察方言过渡的天然窗口。',
      wordIds: ['waini'],
      links: [{ label: '慧听科技 · 数据说明', url: 'http://huitingtech.com/dataInfo.action?id=10014' }] },

    { id: 'longhai', name: '陇海线徐连段方言变异', districtId: 'xinyi', category: 'yanjiu',
      lnglat: [118.312, 34.306], thumb: 'assets/thumbs/longhai.svg',
      tag: '32 个调查点',
      desc: '沿徐州至连云港一线布点，建立含 32 个调查点的方言数据库，采集语音、词汇、语法三个层面的特征数据。铁路沿线，往往就是方言变化的剖面。',
      wordIds: ['gudao'],
      links: [{ label: '万方数据', url: 'https://s.wanfangdata.com.cn' }] },

    { id: 'pizhou', name: '邳州银杏之乡点', districtId: 'pizhou', category: 'ciyu',
      lnglat: [117.958, 34.336], thumb: 'assets/thumbs/pizhou.svg',
      tag: '徐淮片过渡代表点',
      desc: '邳州话与徐州市区话听得懂、说得通，但调值上有细微出入。本地人一开口，邻县人就听得出“这是邳州的”。',
      wordIds: ['bandiaozi'],
      links: [{ label: '万方数据', url: 'https://s.wanfangdata.com.cn' }] },

    { id: 'pizhouyin', name: '邳州方言发音人', districtId: 'pizhou', category: 'fayin',
      lnglat: [117.936, 34.386], thumb: 'assets/thumbs/pizhouyin.svg',
      tag: '七大采录点之一',
      desc: '徐州市语委征召方言发音人，采录点覆盖市区、丰县、沛县、新沂、邳州、睢宁、贾汪七地。一个点一个人，一个人一辈子的话。',
      wordIds: ['yizi'],
      links: [{ label: '中国新闻网 · 报道', url: 'http://www.chinanews.com.cn/cul/2010/11-01/2626683.shtml' }] }
  ],

  /* ---------------- 词条（54 条，去重合并） ----------------
     字段：id 拼音短码 / w 词 / py 拼音 / meaning 释义 / example 例句
           cat 分类 / difficulty 1-5 / levelId 所属关卡（0=不参与闯关）
           districtId 教学归属 / spotId 详情出处（可为 null）
     ---------------------------------------------------------- */
  words: [
    /* —— 第 1 关 · 刚下火车（鼓楼区） —— */
    { id: 'guan',    w: '管',     py: 'guǎn',        meaning: '行、可以、好',       example: '这事儿管不？',              cat: 'changyong', difficulty: 1, levelId: 1, districtId: 'gulou', spotId: null },
    { id: 'zir',     w: '恣儿',   py: 'zìr',         meaning: '高兴、舒服、痛快',   example: '今儿玩得真恣儿。',          cat: 'changyong', difficulty: 1, levelId: 1, districtId: 'gulou', spotId: 'liuqinxi' },
    { id: 'lagua',   w: '拉呱',   py: 'lā guǎ',      meaning: '聊天、唠家常',       example: '咱俩搁这儿拉拉呱。',        cat: 'changyong', difficulty: 1, levelId: 1, districtId: 'gulou', spotId: 'qinshu' },
    { id: 'shangwu', w: '晌午',   py: 'shǎng wu',    meaning: '中午',               example: '晌午吃的啥？',              cat: 'changyong', difficulty: 1, levelId: 1, districtId: 'gulou', spotId: null },
    { id: 'bai',     w: '白',     py: 'bái',         meaning: '别、不要',           example: '你白动那个，怪贵的。',      cat: 'changyong', difficulty: 1, levelId: 1, districtId: 'gulou', spotId: 'fengyin' },

    /* —— 第 2 关 · 街头巷尾（云龙区） —— */
    { id: 'yelai',   w: '夜来',   py: 'yè lái',      meaning: '昨天',               example: '夜来下了一场大雨。',        cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'yunlong', spotId: 'shisanyun' },
    { id: 'ganming', w: '赶明儿', py: 'gǎn míngr',   meaning: '明天、改天',         example: '赶明儿再上你家去。',        cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'yunlong', spotId: null },
    { id: 'jiazou',  w: '家走',   py: 'jiā zǒu',     meaning: '回家',               example: '天黑了，家走吧。',          cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'yunlong', spotId: null },
    { id: 'gengen',  w: '跟跟',   py: 'gēn gēn',     meaning: '附近、旁边',         example: '搁百货大楼跟跟等你。',      cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'yunlong', spotId: null },
    { id: 'renn',    w: '任哪',   py: 'rèn nǎ',      meaning: '到处、任何地方',     example: '东西任哪都找不着。',        cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'yunlong', spotId: null },

    /* —— 第 3 关 · 姥姥家（铜山区） —— */
    { id: 'daocai',  w: '叨菜',   py: 'dāo cài',     meaning: '夹菜（劝人吃菜）',   example: '来来来，别客气，叨菜！',    cat: 'yinshi', difficulty: 3, levelId: 3, districtId: 'tongshan', spotId: null },
    { id: 'hutu',    w: '糊涂',   py: 'hú du',       meaning: '玉米面粥',           example: '早上喝碗糊涂，顶饱。',      cat: 'yinshi', difficulty: 3, levelId: 3, districtId: 'tongshan', spotId: null },
    { id: 'yangshi', w: '洋柿子', py: 'yáng shì zi', meaning: '西红柿',             example: '洋柿子炒鸡蛋最下饭。',      cat: 'yinshi', difficulty: 3, levelId: 3, districtId: 'tongshan', spotId: null },
    { id: 'maozi',   w: '茅子',   py: 'máo zi',      meaning: '厕所',               example: '问一声茅子在哪儿。',        cat: 'yinshi', difficulty: 3, levelId: 3, districtId: 'tongshan', spotId: null },
    { id: 'wudang',  w: '屋当门', py: 'wū dāng mén', meaning: '屋子正中间',         example: '别站屋当门挡着道。',        cat: 'yinshi', difficulty: 3, levelId: 3, districtId: 'tongshan', spotId: null },

    /* —— 第 4 关 · 拉呱斗嘴（贾汪区） —— */
    { id: 'cimao',   w: '疵毛',   py: 'cí máo',      meaning: '孬、不好、差劲',     example: '这东西忒疵毛了。',          cat: 'liyu', difficulty: 4, levelId: 4, districtId: 'jiawang', spotId: null },
    { id: 'dabashou',w: '搭把手', py: 'dā bǎ shǒu',  meaning: '帮个忙',             example: '来搭把手，抬一下桌子。',    cat: 'liyu', difficulty: 4, levelId: 4, districtId: 'jiawang', spotId: null },
    { id: 'deyouyi', w: '得有意', py: 'dé yǒu yì',   meaning: '故意、成心的',       example: '他得有意这么干的。',        cat: 'liyu', difficulty: 4, levelId: 4, districtId: 'jiawang', spotId: null },
    { id: 'mazhan',  w: '马展',   py: 'mǎ zhǎn',     meaning: '立刻、马上',         example: '你等会儿，马展就来。',      cat: 'liyu', difficulty: 4, levelId: 4, districtId: 'jiawang', spotId: null },
    { id: 'haile',   w: '海了',   py: 'hǎi le',      meaning: '多了、非常多',       example: '赶集的人海了去了。',        cat: 'liyu', difficulty: 4, levelId: 4, districtId: 'jiawang', spotId: null },

    /* —— 第 5 关 · 徐州十级（邳州市） —— */
    { id: 'tingting',w: '光光蜓', py: 'guāng guāng tíng', meaning: '蜻蜓',          example: '河边光光蜓飞得低。',        cat: 'gaoshou', difficulty: 5, levelId: 5, districtId: 'pizhou', spotId: null },
    { id: 'shounie', w: '手捏子', py: 'shǒu niē zi', meaning: '手帕',               example: '擦擦汗，给你手捏子。',      cat: 'gaoshou', difficulty: 5, levelId: 5, districtId: 'pizhou', spotId: null },
    { id: 'jueya',   w: '撅丫把子', py: 'juē yā bǎ zi', meaning: '脚',               example: '撅丫把子冻得没知觉了。',    cat: 'gaoshou', difficulty: 5, levelId: 5, districtId: 'pizhou', spotId: null },
    { id: 'gebai',   w: '胳败',   py: 'gē bài',      meaning: '膝盖',               example: '摔了一跤，磕着胳败了。',    cat: 'gaoshou', difficulty: 5, levelId: 5, districtId: 'pizhou', spotId: null },
    { id: 'maoge',   w: '毛格',   py: 'máo gé',      meaning: '硬币',               example: '兜里就剩俩毛格。',          cat: 'gaoshou', difficulty: 5, levelId: 5, districtId: 'pizhou', spotId: null },

    /* —— 拉呱专属（不参与闯关） —— */
    { id: 'shenme',  w: '什么黄子', py: 'shén me huáng zi', meaning: '什么东西',   example: '你说的什么黄子？',          cat: 'lagua', difficulty: 3, levelId: 0, districtId: 'quanshan', spotId: null },
    { id: 'mashang', w: '马上马', py: 'mǎ shàng mǎ', meaning: '一会儿、片刻',       example: '你坐那儿，马上马就好。',    cat: 'lagua', difficulty: 2, levelId: 0, districtId: 'quanshan', spotId: null },
    { id: 'genala',  w: '搁哪来', py: 'gē nǎ lái',   meaning: '在哪儿呢',           example: '百货大楼搁哪来？',          cat: 'lagua', difficulty: 2, levelId: 0, districtId: 'quanshan', spotId: null },
    { id: 'tiliu',   w: '剔溜圆', py: 'tī liū yuán', meaning: '很圆、圆滚滚',       example: '这馍蒸得剔溜圆。',          cat: 'lagua', difficulty: 4, levelId: 0, districtId: 'quanshan', spotId: null },
    { id: 'yangxin', w: '洋心',   py: 'yáng xīn',    meaning: '很得意、得意洋洋',   example: '看他那洋心劲儿。',          cat: 'lagua', difficulty: 4, levelId: 0, districtId: 'quanshan', spotId: null },
    { id: 'yerang',  w: '也嚷',   py: 'yě rǎng',     meaning: '挨批评、被数落',     example: '作业没写，也嚷了一顿。',    cat: 'lagua', difficulty: 4, levelId: 0, districtId: 'quanshan', spotId: null },

    /* —— 地图侧补充（A 项目独有，并入词库） —— */
    { id: 'samo',    w: '撒么',   py: 'sā mo',       meaning: '看、张望',           example: '你撒么撒么，人来了没？',    cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'tongshan', spotId: 'tianshan' },
    { id: 'mazhua',  w: '麻爪',   py: 'má zhuǎ',     meaning: '慌了手脚、没办法',   example: '一听要考试，他立马麻爪了。', cat: 'liyu', difficulty: 4, levelId: 4, districtId: 'quanshan', spotId: 'cidian' },
    { id: 'kechen',  w: '磕碜',   py: 'kē chen',     meaning: '难看、寒碜',         example: '这衣裳穿出去有点磕碜。',    cat: 'liyu', difficulty: 3, levelId: 4, districtId: 'gulou', spotId: null },
    { id: 'deji',    w: '得济',   py: 'dé jì',       meaning: '管用、顶事',         example: '这药真得济，喝两回就好了。', cat: 'changyong', difficulty: 2, levelId: 2, districtId: 'jiawang', spotId: 'jiawang' },
    { id: 'laobizi', w: '老鼻子', py: 'lǎo bí zi',   meaning: '非常多',             example: '夜市上人老鼻子了。',        cat: 'liyu', difficulty: 3, levelId: 4, districtId: 'jiawang', spotId: 'huibian' },
    { id: 'yibengzi',w: '一崩子', py: 'yì bēng zi',  meaning: '一段时间',           example: '等了一崩子他才来。',        cat: 'shenghuo', difficulty: 3, levelId: 3, districtId: 'peixian', spotId: 'huiting' },
    { id: 'yizi',    w: '胰子',   py: 'yí zi',       meaning: '肥皂',               example: '拿块胰子把手洗洗。',        cat: 'shenghuo', difficulty: 3, levelId: 3, districtId: 'pizhou', spotId: 'pizhouyin' },
    { id: 'shiduo',  w: '拾掇',   py: 'shí duo',     meaning: '收拾、整理',         example: '把屋里拾掇拾掇，来客了。',  cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'suining', spotId: 'suining' },
    { id: 'waini',   w: '崴泥',   py: 'wǎi ní',      meaning: '糟了、出麻烦',       example: '这下崴泥了，钥匙锁屋里了。', cat: 'liyu', difficulty: 3, levelId: 4, districtId: 'xinyi', spotId: 'xinyi' },
    { id: 'zhagu',   w: '扎古',   py: 'zhā gu',      meaning: '医治',               example: '赶紧去医院扎古扎古。',      cat: 'gaoshou', difficulty: 4, levelId: 5, districtId: 'peixian', spotId: null },
    { id: 'hulielie',w: '胡咧咧', py: 'hú liē lie',  meaning: '胡说八道',           example: '你白胡咧咧，没那回事。',    cat: 'liyu', difficulty: 3, levelId: 4, districtId: 'fengxian', spotId: null },
    { id: 'gudao',   w: '鼓捣',   py: 'gǔ dao',      meaning: '摆弄、折腾',         example: '一上午就鼓捣那个收音机。',  cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'xinyi', spotId: 'longhai' },
    { id: 'zoume',   w: '揍么',   py: 'zòu me',      meaning: '干什么',             example: '你揍么去？这么急。',        cat: 'changyong', difficulty: 1, levelId: 1, districtId: 'fengxian', spotId: 'fengxian' },
    { id: 'nen',     w: '恁',     py: 'nèn',         meaning: '你们；那么',         example: '恁都来了？快坐。',          cat: 'changyong', difficulty: 2, levelId: 2, districtId: 'peixian', spotId: 'peixian' },
    { id: 'an',      w: '俺',     py: 'ǎn',          meaning: '我、我们',           example: '俺家就在这条街上。',        cat: 'changyong', difficulty: 1, levelId: 1, districtId: 'tongshan', spotId: 'map3d' },
    { id: 'guada',   w: '呱嗒',   py: 'guā da',      meaning: '说话、闲聊',         example: '他俩在门口呱嗒半天了。',    cat: 'lagua', difficulty: 3, levelId: 0, districtId: 'quanshan', spotId: 'yanchuan', unlockOnVisit: true },
    { id: 'xihan',   w: '稀罕',   py: 'xī han',      meaning: '喜欢、疼爱',         example: '奶奶最稀罕这小孙子。',      cat: 'shenghuo', difficulty: 2, levelId: 2, districtId: 'suining', spotId: 'tongyao' },
    { id: 'bandiaozi', w: '半吊子', py: 'bàn diào zi', meaning: '缺心眼、不靠谱',   example: '他是个半吊子，别指望他。',  cat: 'liyu', difficulty: 4, levelId: 4, districtId: 'pizhou', spotId: 'pizhou' },
    { id: 'babuneng',w: '巴不能', py: 'bā bu néng',  meaning: '巴不得',             example: '巴不能早点下班回家。',      cat: 'liyu', difficulty: 3, levelId: 3, districtId: 'yunlong', spotId: null },
    { id: 'puleng',  w: '扑棱',   py: 'pū leng',     meaning: '扑腾、挣扎',         example: '鱼在盆里直扑棱。',          cat: 'shenghuo', difficulty: 4, levelId: 5, districtId: 'xinyi', spotId: null },
    { id: 'xiexie',  w: '些些',   py: 'xiē xiē',     meaning: '非常、很',           example: '今儿些些冷，多穿点。',      cat: 'changyong', difficulty: 2, levelId: 2, districtId: 'yunlong', spotId: 'songdu' },
    { id: 'ladao',   w: '拉倒',   py: 'lā dǎo',      meaning: '算了、作罢',         example: '拉倒吧，甭争了。',          cat: 'changyong', difficulty: 2, levelId: 2, districtId: 'gulou', spotId: null },
    { id: 'shidehuang', w: '使得慌', py: 'shǐ de huang', meaning: '累、疲乏',        example: '走了一天，使得慌。',        cat: 'shenghuo', difficulty: 3, levelId: 3, districtId: 'tongshan', spotId: null }
  ],

  /* ---------------- 关卡（与区县绑定） ---------------- */
  levels: [
    { id: 1, name: '刚下火车', desc: '初到彭城，先把耳朵打开', place: '车站 · 出站口', districtId: 'gulou' },
    { id: 2, name: '街头巷尾', desc: '走上街，听懂徐州人的日常', place: '淮海路 · 老街', districtId: 'yunlong' },
    { id: 3, name: '姥姥家',   desc: '饭桌上的徐州话最地道',   place: '堂屋 · 饭桌', districtId: 'tongshan' },
    { id: 4, name: '拉呱斗嘴', desc: '俚语土话，越听越上头',   place: '树底下 · 几个老头', districtId: 'jiawang' },
    { id: 5, name: '徐州十级', desc: '能全对，你就是徐州人',   place: '彭城七里 · 终极关', districtId: 'pizhou' }
  ],

  /* ---------------- 拉呱场景（对话树） ---------------- */
  scenes: [
    {
      id: 'zaodian', name: '早点摊儿', place: '徐州 · 建国路早点摊', avatar: '摊',
      districtId: 'gulou', start: 'n1',
      nodes: {
        n1: { npc: '小伙子，吃点啥？', py: 'xiǎo huǒ zi，chī diǎn shá？',
          opts: [
            { t: '来碗糊涂，再要俩火烧。', score: 20, unlock: ['mashang'], next: 'n2a',
              reply: '管！马上马就好，你搁那儿坐着等。', replyPy: 'guǎn！mǎ shàng mǎ jiù hǎo。' },
            { t: '来杯美式咖啡。', score: 5, unlock: ['shenme'], next: 'n2b',
              reply: '啥黄子？俺这摊子上可没有那洋玩意儿。', replyPy: 'shá huáng zi？' },
            { t: '随便。', score: 0, unlock: [], next: 'n2c',
              reply: '随便？那你白吃了。', replyPy: 'suí biàn？nà nǐ bái chī le。' }
          ] },
        n2a: { npc: '糊涂给你盛上了，火烧刚出炉，趁热！', py: 'hú du gěi nǐ chéng shàng le。',
          opts: [
            { t: '恣儿！还是这味儿地道。', score: 20, unlock: ['zir'], next: null,
              reply: '这孩儿会说话，多给你卧个蛋！', replyPy: 'zhè hái ér huì shuō huà。' },
            { t: '多少钱？', score: 10, unlock: [], next: null,
              reply: '一块五。白掏了，算俺请你的。', replyPy: 'yī kuài wǔ。bái tāo le。' }
          ] },
        n2b: { npc: '喝糊涂不？咱徐州人的「咖啡」。', py: 'hē hú du bù？',
          opts: [
            { t: '行，来一碗尝尝。', score: 15, unlock: ['hutu'], next: null,
              reply: '这才对嘛，管！', replyPy: 'zhè cái duì ma，guǎn！' },
            { t: '不用了，谢谢大爷。', score: 5, unlock: [], next: null,
              reply: '那你去别处转转吧。', replyPy: 'nà nǐ qù bié chù zhuàn zhuàn ba。' }
          ] },
        n2c: { npc: '孩儿，你想吃啥直说白。', py: 'hái ér，nǐ xiǎng chī shá zhí shuō bái。',
          opts: [
            { t: '来碗糊涂，俩火烧。', score: 15, unlock: ['mashang'], next: null,
              reply: '管！马上马。', replyPy: 'guǎn！mǎ shàng mǎ。' },
            { t: '算了，我不吃了。', score: 0, unlock: [], next: null,
              reply: '白走啊，尝尝俺这儿的。', replyPy: 'bái zǒu a。' }
          ] }
      }
    },
    {
      id: 'wenlu', name: '街上问路', place: '徐州 · 淮海路街口', avatar: '爷',
      districtId: 'yunlong', start: 'n1',
      nodes: {
        n1: { npc: '孩儿，你搁这儿转悠啥来？', py: 'hái ér，nǐ gē zhèr zhuàn you shá lái？',
          opts: [
            { t: '大爷，百货大楼搁哪来？', score: 20, unlock: ['genala'], next: 'n2a',
              reply: '往前头直走，搁跟跟就到了。', replyPy: 'wǎng qián tóu zhí zǒu。' },
            { t: '请问，百货大楼怎么走？', score: 8, unlock: [], next: 'n2b',
              reply: '普通话俺也听得懂，就是你这味儿不地道。', replyPy: 'jiù shì nǐ zhè wèi ér bù dì dào。' },
            { t: '没事，随便看看。', score: 0, unlock: [], next: null,
              reply: '那你慢慢遛达吧。', replyPy: 'nà nǐ màn màn liù da ba。' }
          ] },
        n2a: { npc: '记住喽，过了红绿灯往左拐。', py: 'guò le hóng lǜ dēng wǎng zuǒ guǎi。',
          opts: [
            { t: '谢了大爷，您老真管！', score: 20, unlock: ['guan'], next: null,
              reply: '白客气，慢点走！', replyPy: 'bái kè qi，màn diǎn zǒu！' },
            { t: '好嘞，我明白了。', score: 12, unlock: [], next: null,
              reply: '行，去吧。', replyPy: 'xíng，qù ba。' }
          ] },
        n2b: { npc: '你要想学徐州话，就跟着大爷我念。', py: 'nǐ yào xiǎng xué xú zhōu huà，jiù gēn zhe wǒ niàn。',
          opts: [
            { t: '搁哪来——我试试。', score: 15, unlock: ['genala'], next: null,
              reply: '哎，就是这个味儿！', replyPy: 'āi，jiù shì zhè ge wèi ér！' },
            { t: '算了，我还是说普通话吧。', score: 5, unlock: [], next: null,
              reply: '都管，都管。', replyPy: 'dōu guǎn，dōu guǎn。' }
          ] }
      }
    },
    {
      id: 'laolao', name: '姥姥家吃饭', place: '徐州 · 姥姥家堂屋', avatar: '姥',
      districtId: 'tongshan', start: 'n1',
      nodes: {
        n1: { npc: '哎呀俺的乖孙来了！快坐，叨菜！', py: 'āi yā ǎn de guāi sūn lái le！',
          opts: [
            { t: '恣儿！姥姥做的饭最管！', score: 20, unlock: ['daocai'], next: 'n2a',
              reply: '哎哟，会说话！多吃点！', replyPy: 'āi yō，huì shuō huà！' },
            { t: '姥姥，我在减肥。', score: 5, unlock: [], next: 'n2b',
              reply: '减啥肥，看你这瘦的！', replyPy: 'jiǎn shá féi，kàn nǐ zhè shòu de！' },
            { t: '这菜有点咸。', score: 0, unlock: [], next: 'n2c',
              reply: '嫌咸白吃，俺自己吃。', replyPy: 'xián xián bái chī。' }
          ] },
        n2a: { npc: '来，尝尝这个，姥姥腌的咸菜。', py: 'lái，cháng chang zhè ge。',
          opts: [
            { t: '剔溜圆，好吃！', score: 20, unlock: ['tiliu'], next: null,
              reply: '哈哈，还是俺孙子懂俺。', replyPy: 'hái shi ǎn sūn zi dǒng ǎn。' },
            { t: '洋心！姥姥手艺没得说。', score: 15, unlock: ['yangxin'], next: null,
              reply: '就你嘴甜。', replyPy: 'jiù nǐ zuǐ tián。' }
          ] },
        n2b: { npc: '不吃饭哪行，来碗糊涂垫垫。', py: 'bù chī fàn nǎ xíng。',
          opts: [
            { t: '行，那我少喝点。', score: 12, unlock: ['hutu'], next: null,
              reply: '这才对嘛。', replyPy: 'zhè cái duì ma。' },
            { t: '真不饿，姥姥。', score: 5, unlock: [], next: null,
              reply: '那也得吃，不吃俺生气。', replyPy: 'bù chī ǎn shēng qì。' }
          ] },
        n2c: { npc: '咸？那俺给你倒点水去。', py: 'xián？nà ǎn gěi nǐ dào diǎn shuǐ。',
          opts: [
            { t: '姥姥我逗你玩来，好吃着呢！', score: 15, unlock: ['yerang'], next: null,
              reply: '你这孩儿，也嚷你！', replyPy: 'nǐ zhè hái ér，yě rǎng nǐ！' },
            { t: '确实是咸了。', score: 0, unlock: [], next: null,
              reply: '……那你白吃了。', replyPy: 'nà nǐ bái chī le。' }
          ] }
      }
    }
  ],

  /* ---------------- 等级 ---------------- */
  tiers: [
    { min: 0,   max: 59,  name: '徐州话萌新', short: '萌新', icon: '🌱' },
    { min: 60,  max: 119, name: '徐州话三级', short: '三级', icon: '🥉' },
    { min: 120, max: 199, name: '徐州话六级', short: '六级', icon: '🥈' },
    { min: 200, max: 99999, name: '徐州话十级', short: '十级', icon: '🏆' }
  ]
};
