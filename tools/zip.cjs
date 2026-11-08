/* ============================================================
   tools/zip.cjs — 极小的 ZIP 写入器（deflate，无第三方依赖）
   ------------------------------------------------------------
   为什么自己写：打包脚本原本不生成 zip，免安装包是手工压的 ——
   于是发出去的 zip 里躺着一个 11-06 的旧 exe，而 dist 里早就是新版了
   （第 6 轮审计的 F1 就是这么来的：zip 内 exe 缺「下一题」修复）。
   手工步骤只要还会被忘，就迟早再犯一次，所以把 zip 变成构建的一部分。

   只做需要的那点事：多个文件、deflate、UTF-8 文件名、DOS 时间戳。
   不支持 ZIP64（单文件、整包都远小于 4GB）、不支持加密、不支持目录项。
   ============================================================ */
'use strict';

const zlib = require('zlib');

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** DOS 时间：秒只有 2 秒精度，是最常见的"为什么时间不对"来源，这里如实截断 */
function dosTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/**
 * @param {Array<{name:string, data:Buffer, date?:Date}>} entries
 * @returns {Buffer}
 */
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  entries.forEach(function (e) {
    const name = Buffer.from(String(e.name), 'utf8');
    const data = e.data;
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    /* 压不动就存原文 —— 已经压过的 exe 也可能反而变大 */
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const t = dosTime(e.date || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flag: 文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(t.time, 10);
    local.writeUInt16LE(t.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);            // version made by
    cen.writeUInt16LE(20, 6);            // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(t.time, 12);
    cen.writeUInt16LE(t.date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);            // extra
    cen.writeUInt16LE(0, 32);            // comment
    cen.writeUInt16LE(0, 34);            // disk start
    cen.writeUInt16LE(0, 36);            // internal attrs
    cen.writeUInt32LE(0, 38);            // external attrs
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += 30 + name.length + body.length;
  });

  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(parts), cenBuf, eocd]);
}

module.exports = { zip: zip, crc32: crc32 };
