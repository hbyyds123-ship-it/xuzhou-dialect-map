/* ============================================================
   extract.cjs — 按"缩进标记"从 app.js 里取可独立求值的代码段
   ------------------------------------------------------------
   为什么不用行号：外部验收按固定行号切片（134–200 / 203–216 / 504–528）时，
   任何一次插入都会让它切到错的代码，而且往往不报错、只是悄悄给出错误结论。
   行号位移在本轮合并里真的发生了（recorder/app.js 增加录音索引回写后，
   encodeWavBase64 从 504 移到 505），旧的行号检查就此变红。

   现改成缩进锚定的标记提取，三个标记只依赖代码写法、不依赖位置：
     - "const Analysis = {"  … 同缩进的 "};"      → 对象成员文本（mono/f0/levels）
     - 行首 "function stats("                 … 行首 "}" → 完整函数文本
     - 行首 "function encodeWavBase64("        … 行首 "}" → 同上
   标记找不到时一律抛错，绝不静默返回空串。

   用法：const ex = require('./extract.cjs')(SRC_LINES)
   ============================================================ */
'use strict';

function indexOfRe(lines, re) {
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

function objMembers(lines, varName) {
  const s = indexOfRe(lines, new RegExp('^\\s*const ' + varName + ' = \\{'));
  if (s < 0) throw new Error('标记缺失：找不到 const ' + varName + ' = {');
  const indent = lines[s].match(/^\s*/)[0];
  for (let i = s + 1; i < lines.length; i++) {
    if (lines[i] === indent + '};') return lines.slice(s + 1, i).join('\n');
  }
  throw new Error('标记缺失：const ' + varName + ' 没有同缩进的 }; 收尾');
}

function topFunction(lines, name) {
  const s = indexOfRe(lines, new RegExp('^function ' + name + '\\('));
  if (s < 0) throw new Error('标记缺失：找不到行首 function ' + name + '(');
  for (let i = s + 1; i < lines.length; i++) if (lines[i] === '}') return lines.slice(s, i + 1).join('\n');
  throw new Error('标记缺失：function ' + name + ' 没有行首 } 收尾');
}

module.exports = function extract(lines) {
  return {
    analysis: () => objMembers(lines, 'Analysis'),
    stats: () => topFunction(lines, 'stats'),
    wav: () => topFunction(lines, 'encodeWavBase64')
  };
};
