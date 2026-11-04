/* ============================================================
   build-portable.cjs — 打一个"发过去双击就能用"的单文件 exe
   ------------------------------------------------------------
   为什么不是「一个 HTML 文件」：浏览器**不会在 file:// 下给麦克风**，
   双击 HTML 只能看、不能录。所以必须自带一个本机服务；
   为了让别人不用装 Node，把 Node 运行时、服务与全部静态文件打进一个 exe
   （Node 22 的 SEA：Single Executable Application）。

   产物：
     dist/徐州方言地图.exe        单文件，双击即用（约 85–90 MB）
     dist/使用说明.txt            给接收方的一页说明

   用法：node tools/build-portable.cjs
   依赖：本机 node（要跟目标机器同为 x64 架构）、npx（拉 postject 做注入）
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(ROOT, 'portable');
const EXE_NAME = '乡音册.exe';

const ASSETS = [
  'index.html',
  'css/style.css', 'css/paper.css',
  'features/quiz.css', 'features/scene.css',
  'features/sample.js', 'features/quiz.js', 'features/scene.js',
  'js/app.js',
  'core/store.js', 'core/router.js',
  'data/atlas.js', 'data/geo.xuzhou.js',
  'vendor/three.min.js', 'vendor/OrbitControls.js',
  'recorder/index.html', 'recorder/app.js', 'recorder/prompts.js', 'recorder/prompts-atlas.js'
];

function walk(dir, out) {
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((d) => {
    const rel = dir + '/' + d.name;
    if (d.isDirectory()) walk(rel, out);
    else if (/\.svg$/i.test(d.name)) out.push(rel);
  });
  return out;
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8', cwd: ROOT }, opts || {}));
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')}`);
    console.error((r.stdout || '') + (r.stderr || ''));
    throw new Error(`${cmd} 执行失败（exit ${r.status}）`);
  }
  return (r.stdout || '').trim();
}

async function main() {
  const files = ASSETS.concat(walk('assets/thumbs', []));
  const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) throw new Error('缺文件：' + missing.join(', '));

  fs.mkdirSync(DIST, { recursive: true });

  // 1) 生成 SEA 配置：把每个静态文件按相对路径登记为资源
  const assets = {};
  files.forEach((f) => { assets[f] = f; });
  const cfgPath = path.join(TMP, 'sea-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    main: 'portable/main.cjs',
    output: 'portable/sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets
  }, null, 2), 'utf8');
  console.log(`· 登记资源 ${files.length} 个`);

  // 2) 生成 blob
  run(process.execPath, ['--experimental-sea-config', path.relative(ROOT, cfgPath)]);
  const blob = path.join(TMP, 'sea-prep.blob');
  const blobSize = fs.statSync(blob).size;
  console.log(`· blob ${(blobSize / 1024).toFixed(0)} KB`);

  // 3) 复制 node 本体，再注入 blob
  const IS_MAC = process.platform === 'darwin';
  const exe = path.join(DIST, IS_MAC ? '徐州方言地图' : EXE_NAME);
  fs.copyFileSync(process.execPath, exe);
  // macOS：node 本体带签名，注入前必须先去掉，装完再 ad-hoc 签名
  if (IS_MAC) {
    try { run('codesign', ['--remove-signature', exe]); } catch (e) { console.warn('! 去签名失败：' + e.message); }
  }
  console.log(`· 复制运行时 ${(fs.statSync(exe).size / 1048576).toFixed(1)} MB`);

  const inject = ['--yes', 'postject@1.0.0-alpha.6', exe, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (IS_MAC) inject.push('--macho-segment-name', 'NODE_SEA_BLOB');
  run('npx', inject, { cwd: DIST, shell: process.platform === 'win32' });
  if (IS_MAC) {
    try { run('codesign', ['--sign', '-', exe]); console.log('· 已做 ad-hoc 签名'); } catch (e) { console.warn('! 签名失败：' + e.message); }
  }
  console.log(`· 注入完成 → ${path.relative(ROOT, exe)}（${(fs.statSync(exe).size / 1048576).toFixed(1)} MB）`);

  // 3.5) 换图标：默认是 node 的图标，任务栏上认不出是什么
  const ico = path.join(TMP, 'icon.ico');
  if (!IS_MAC && fs.existsSync(ico)) {
    try {
      const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit');
      const pe = NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
      const res = NtExecutableResource.from(pe);
      const icoFile = Data.IconFile.from(fs.readFileSync(ico));
      Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icoFile.icons.map((i) => i.data));
      res.outputResource(pe);
      fs.writeFileSync(exe, Buffer.from(pe.generate()));
      console.log('· 图标已写入（朱色方章「徐」）');
    } catch (e) {
      console.warn('! 图标写入失败（不影响使用）：' + e.message);
    }
  } else if (!IS_MAC) {
    console.warn('! 没有 portable/icon.ico，保留默认图标（可先跑 node portable/make-icon.cjs）');
  }

  // 4) 自检：跑 exe 自己的 --self-test
  const probe = spawnSync(exe, ['--self-test'], { encoding: 'utf8', cwd: DIST, timeout: 120000 });
  const out = ((probe.stdout || '') + (probe.stderr || '')).trim();
  console.log(out);
  if (probe.status !== 0) throw new Error('打包产物自检未通过');

  // 5) 一页说明
  fs.writeFileSync(path.join(DIST, '使用说明.txt'), [
    '乡音册 · 徐州方言档案（免安装版）',
    '',
    '怎么用',
    '  1. 双击「徐州方言地图.exe」',
    '  2. 会弹出一个黑色的命令行窗口，浏览器自动打开《乡音册》',
    '  3. 右上角一排按钮里最下面那个麦克风，进采样台录音',
    '  4. 用完关掉那个黑窗口就行（服务随之停止）',
    '',
    '为什么要有黑窗口',
    '  浏览器只在 http://127.0.0.1 这类本机地址上给麦克风权限，',
    '  直接双击 HTML 是打不开录音的。这个 exe 自带了一个本机小服务。',
    '',
    '数据在哪',
    '  录音和标注只存在你自己的浏览器里（IndexedDB），不上传、不联网。',
    '  换浏览器或清空浏览数据，录音就没了——确认无误后请用「导出单文件存档」',
    '  导出一份 HTML，那个文件可以单独保存、转发、十年后还能打开。',
    '',
    '可能遇到',
    '  · Windows 提示「已保护你的电脑」：点「更多信息 → 仍要运行」。',
    '    这是因为 exe 没有代码签名，不是文件有问题。',
    '  · 浏览器拦截麦克风：地址必须是 127.0.0.1 开头，点地址栏左侧的图标允许麦克风。',
    '  · 端口被占用：程序会自动换端口，请以黑窗口里打印的地址为准。',
    ''
  ].join('\r\n'), 'utf8');

  console.log('\n✓ 打包完成：');
  console.log('  ' + path.relative(ROOT, exe));
  console.log('  ' + path.relative(ROOT, path.join(DIST, '使用说明.txt')));
}

main().catch((e) => { console.error('\n打包失败：' + e.message); process.exit(1); });
