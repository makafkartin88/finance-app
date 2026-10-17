import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import zlib from 'node:zlib';

// gas-update.js je Apps Script (globální funkce) → načíst do izolovaného kontextu.
const gas = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../gas-update.js', import.meta.url), 'utf8'), gas);

// ── Testovací ZIP zašifrovaný klasickým PKWARE ZipCrypto (jako UniCredit) ──
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function keysFor(pwd) {
  const k = [0x12345678, 0x23456789, 0x34567890];
  const up = b => {
    k[0] = (CRC[(k[0] ^ b) & 0xff] ^ (k[0] >>> 8)) >>> 0;
    k[1] = (Math.imul((k[1] + (k[0] & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k[2] = (CRC[(k[2] ^ (k[1] >>> 24)) & 0xff] ^ (k[2] >>> 8)) >>> 0;
  };
  for (const ch of Buffer.from(pwd, 'latin1')) up(ch);
  return { k, up };
}
function encryptedZip(name, content, pwd, { dataDescriptor = true } = {}) {
  const data = Buffer.from(content);
  const comp = zlib.deflateRawSync(data);
  const crc = crc32(data);
  const modTime = 0x6A2B, modDate = 0x5B4E;
  const { k, up } = keysFor(pwd);
  const head = Buffer.alloc(12, 0x5a);
  head[11] = dataDescriptor ? (modTime >> 8) & 0xff : (crc >>> 24) & 0xff;
  const plain = Buffer.concat([head, comp]);
  const enc = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i++) {
    const t = (k[2] | 2) & 0xffff;
    enc[i] = plain[i] ^ (((t * (t ^ 1)) >>> 8) & 0xff);
    up(plain[i]);
  }
  const flags = 1 | (dataDescriptor ? 8 : 0);
  const fn = Buffer.from(name);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt16LE(modTime, 10); lh.writeUInt16LE(modDate, 12);
  if (!dataDescriptor) { lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(enc.length, 18); lh.writeUInt32LE(data.length, 22); }
  lh.writeUInt16LE(fn.length, 26);
  const dd = dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (dataDescriptor) { dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(enc.length, 8); dd.writeUInt32LE(data.length, 12); }
  const local = Buffer.concat([lh, fn, enc, dd]);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(modTime, 12); ch.writeUInt16LE(modDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(enc.length, 20);
  ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(fn.length, 28); ch.writeUInt32LE(0, 42);
  const cd = Buffer.concat([ch, fn]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, cd, eocd]);
}

// Minimální čtečka (nešifrovaného) ZIPu přes centrální adresář.
function readPlainZip(bytes) {
  const b = Buffer.from(bytes);
  const e = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = b.readUInt16LE(e + 10);
  let p = b.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const flags = b.readUInt16LE(p + 8), csize = b.readUInt32LE(p + 20), fnl = b.readUInt16LE(p + 28);
    const xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.slice(p + 46, p + 46 + fnl).toString();
    const ds = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    out.push({ name, flags, crc: b.readUInt32LE(p + 16), data: zlib.inflateRawSync(b.slice(ds, ds + csize)).toString() });
    p += 46 + fnl + xl + cl;
  }
  return out;
}

const toArr = buf => Array.from(buf);

test('zipDecryptToPlain: ZipCrypto (s data descriptorem) → nešifrovaný ZIP se stejným obsahem', () => {
  const zip = encryptedZip('Vypis_CP.pdf', '%PDF-1.4 vypis obsah '.repeat(50), 'Heslo123');
  const plain = gas.zipDecryptToPlain(toArr(zip), 'Heslo123');
  const [e] = readPlainZip(plain);
  assert.equal(e.name, 'Vypis_CP.pdf');
  assert.equal(e.flags & 1, 0);
  assert.equal(e.data, '%PDF-1.4 vypis obsah '.repeat(50));
});

test('zipDecryptToPlain: ZipCrypto bez data descriptoru (kontrola heslem přes CRC)', () => {
  const zip = encryptedZip('a.pdf', 'obsah', 'pw', { dataDescriptor: false });
  assert.equal(readPlainZip(gas.zipDecryptToPlain(toArr(zip), 'pw'))[0].data, 'obsah');
});

test('zipDecryptToPlain: špatné heslo → srozumitelná chyba', () => {
  const zip = encryptedZip('a.pdf', 'obsah', 'spravne');
  assert.throws(() => gas.zipDecryptToPlain(toArr(zip), 'spatne'), /heslo/i);
});

test('zipDecryptToPlain: vstup jako podepsané bajty (GAS getBytes vrací -128..127)', () => {
  const zip = encryptedZip('a.pdf', 'obsah ěščř', 'pw');
  const signed = toArr(zip).map(b => (b > 127 ? b - 256 : b));
  assert.equal(readPlainZip(gas.zipDecryptToPlain(signed, 'pw'))[0].data, 'obsah ěščř');
});

test('navSourceFor: CONSEQ fond bez ručního záznamu dostane stránku podle ISIN', () => {
  const s = gas.navSourceFor('CONSEQ', 'CZ0008475936');
  assert.equal(s.url, 'https://www.conseq.cz/investment/mutual-funds/cz0008475936?lang=cs-cz');
  assert.equal(s.anchor, 'Cena za kus');
  assert.equal(gas.navSourceFor('CODYA', 'CZ9999999999'), null);
  assert.match(gas.navSourceFor('CODYA', 'CZ0008042892').url, /codyainvest\.cz/);
});

// Jednorázově ověřit, že testovací šifrování odpovídá standardu (čte ho Python):
//   node -e "..." > t.zip && python -c "import zipfile;print(zipfile.ZipFile('t.zip').read('a.pdf',pwd=b'pw'))"
export { encryptedZip };
