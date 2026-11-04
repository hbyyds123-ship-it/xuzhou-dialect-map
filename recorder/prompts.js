/* ============================================================
   prompts.js — 题库（你自己随时改这里，不用动引擎）
   ------------------------------------------------------------
   分四类，设计原则是「按语言事实的结构出题」，不是随便列词：

     new  新事物：长辈的语言里原本没有这个词，是年轻人补出来的。
          关键不是「怎么说」，而是「用哪套策略把它方言化」。
     old  老器物：长辈会说，你这代可能已经不会，孩子大概率没听过。
          这一类的价值在于「它正在消失」，录一条少一条。
     home 家词：只有你家/你村这么说的称呼与口头禅。任何语料库都不会有。
     sent 句：句子录下来的是语序和语气，只有词是录不到这些的。

   每条：
     id     唯一，会成为存档主键的一部分
     bucket new / old / home / sent
     text   题目（系统问你的那句话）
     hint   提示，帮你「往哪个方向想」，不预设答案
     gloss  可选：给孩子的释义，测验与导出时用
   ============================================================ */
window.PROMPTS = [

  /* ---------------- 新事物：长辈没有，你补的 ---------------- */
  { id: 'n-kfc',    bucket: 'new', expectedStrategy: '意译', text: '肯德基',   hint: '直接说“肯德基”，还是另有说法？想想“洋柿子”“洋碱”那条老路。', gloss: '洋快餐' },
  { id: 'n-mcd',    bucket: 'new', expectedStrategy: '借音', text: '麦当劳',   hint: '同上。两个外来快餐，说法一样吗？' },
  { id: 'n-phone',  bucket: 'new', expectedStrategy: '借音', text: '手机',     hint: '家里老人是直接说“手机”，还是有别的叫法？' },
  { id: 'n-wx',     bucket: 'new', expectedStrategy: '借音', text: '微信',     hint: '“加个微信”这句话，用你家的说法怎么讲？' },
  { id: 'n-pay',    bucket: 'new', expectedStrategy: '意译', text: '扫码付钱', hint: '是“扫一下”，还是“照一下”“晃一下”？动词最重要。' },
  { id: 'n-takeout',bucket: 'new', expectedStrategy: '旧词延伸', text: '点外卖',   hint: '“叫外卖”还是“要外卖”“买外卖”？动词差别就是方言差别。' },
  { id: 'n-power',  bucket: 'new', expectedStrategy: '旧词延伸', text: '充电宝',   hint: '“宝”这个字进来之后，你要加什么量词？' },
  { id: 'n-ac',     bucket: 'new', expectedStrategy: '旧词延伸', text: '开空调',   hint: '空调用“开”还是“打”？这是最容易露馅的一个。' },
  { id: 'n-live',   bucket: 'new', expectedStrategy: '旧词延伸', text: '看直播',   hint: '“刷”“看”“瞧”？' },
  { id: 'n-nav',    bucket: 'new', expectedStrategy: '意译', text: '导航',     hint: '“跟着导航走”整句更好。' },

  /* ---------------- 老器物：正在消失的 ---------------- */
  { id: 'o-tangci', bucket: 'old', text: '搪瓷缸',   hint: '喝水的那个白底红字的缸子。' },
  { id: 'o-lamp',   bucket: 'old', text: '煤油灯',   hint: '停电时候点的那个。' },
  { id: 'o-feng',   bucket: 'old', text: '风箱',     hint: '灶台边“呼嗒呼嗒”拉的那个。' },
  { id: 'o-binzi',  bucket: 'old', text: '篦子',     hint: '比梳子齿密，用来篦虱子的。' },
  { id: 'o-boji',   bucket: 'old', text: '簸箕',     hint: '扬场、收粮食那个。' },
  { id: 'o-lulu',   bucket: 'old', text: '辘轳',     hint: '井口上摇的那个。' },
  { id: 'o-well',   bucket: 'old', text: '压水井',   hint: '要先倒一瓢引水的那种。' },
  { id: 'o-yard',   bucket: 'old', text: '场院',     hint: '打麦子、晒粮食的空地。' },
  { id: 'o-cart',   bucket: 'old', text: '地排车',   hint: '两个胶轮、两根长把的板车。' },
  { id: 'o-match',  bucket: 'old', text: '洋火',     hint: '火柴。注意：这词本身就是上一轮的“新词”。', gloss: '火柴' },
  { id: 'o-soap',   bucket: 'old', text: '洋碱',     hint: '肥皂。和“胰子”是同一个东西吗？', gloss: '肥皂' },
  { id: 'o-maozi',  bucket: 'old', text: '茅子',     hint: '厕所。' , gloss: '厕所' },
  { id: 'o-wudang', bucket: 'old', text: '屋当门',   hint: '屋子正中间那块地方。', gloss: '屋中央' },
  { id: 'o-corn',   bucket: 'old', text: '棒子',     hint: '玉米。你们那儿叫“棒子”还是别的？', gloss: '玉米' },
  { id: 'o-potato', bucket: 'old', text: '地蛋',     hint: '土豆。', gloss: '土豆' },
  { id: 'o-towel',  bucket: 'old', text: '手捏子',   hint: '手帕。', gloss: '手帕' },

  /* ---------------- 家词：只有你家这么说 ---------------- */
  { id: 'h-call',   bucket: 'home', text: '喊孩子回家吃饭', hint: '不许说“吃饭了”——说出家里真正喊的那一句。' },
  { id: 'h-dad',    bucket: 'home', text: '爸爸的哥哥',     hint: '“大爷”“大伯”还是别的？这是最容易看出地域的一个词。' },
  { id: 'h-mom',    bucket: 'home', text: '妈妈的姐姐',     hint: '同上。' },
  { id: 'h-grand',  bucket: 'home', text: '奶奶的母亲',     hint: '往上数第三代的称呼，会说的人越来越少了。' },
  { id: 'h-coax',   bucket: 'home', text: '哄小孩别哭',     hint: '家里常用的那一句哄人的话。' },
  { id: 'h-praise', bucket: 'home', text: '夸孩子聪明',     hint: '“真机灵”“真能”还是别的？' },
  { id: 'h-scold',  bucket: 'home', text: '数落孩子',       hint: '不太难听的那一句。' },
  { id: 'h-object', bucket: 'home', text: '家里对某样东西的专属叫法', hint: '比如对某个凳子、某辆车的昵称。任何语料库都不会有这一条。' },

  /* ---------------- 句：录语序和语气 ---------------- */
  { id: 's-come',   bucket: 'sent', text: '“回来吃饭！”这句话怎么说？', hint: '注意语序和语气词。' },
  { id: 's-where',  bucket: 'sent', text: '“你在哪儿呢？”怎么说？',   hint: '注意“在”会不会被省掉。' },
  { id: 's-stop',   bucket: 'sent', text: '“别动那个，贵。”怎么说？',  hint: '注意“别”说成什么。' },
  { id: 's-tmr',    bucket: 'sent', text: '“明天再去吧。”怎么说？',    hint: '“明天”在方言里常常不是“明天”。' },
  { id: 's-taste',  bucket: 'sent', text: '“这菜真好吃。”怎么说？',    hint: '夸的程度词最关键。' },
  { id: 's-tired',  bucket: 'sent', text: '“我累坏了。”怎么说？',      hint: '注意“很累”的补语。' },
  { id: 's-hurry',  bucket: 'sent', text: '“快点，来不及了。”怎么说？', hint: '注意催促的语气词。' },
  { id: 's-nice',   bucket: 'sent', text: '“这孩子真懂事。”怎么说？',  hint: '“懂事”在方言里常有别的说法。' }
];
