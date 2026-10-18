import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip, crc32, isSafeName } from '../zip.js';

// ---- crc32 -----------------------------------------------------------------------------------------
assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
assert.equal(crc32(new Uint8Array(0)), 0);
console.log('ok  crc32 matches the standard check value');

// ---- names -----------------------------------------------------------------------------------------
for (const good of ['a.md', 'folder/a.md', 'Guide-X/images/step-01.jpg', 'café/日本語.txt']) assert.ok(isSafeName(good), good);
for (const bad of ['', '/abs.txt', '../escape.txt', 'a/../../b', 'a//b', 'a/', 'back\\slash', 'C:/x', 'nul\0.txt', null, undefined, 5]) assert.ok(!isSafeName(bad), `should reject ${JSON.stringify(bad)}`);
assert.throws(() => buildZip([{ name: '../x', data: 'a' }]), /Unsafe/);
assert.throws(() => buildZip([{ name: 'a', data: 'a' }, { name: 'a', data: 'b' }]), /Duplicate/);
console.log('ok  unsafe and duplicate names are refused (zip slip)');

// ---- round trip with an independent reader (written here, from the spec) ----------------------------
function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  assert.equal(v.getUint32(e, true), 0x06054b50, 'end-of-central-directory record is last');
  const count = v.getUint16(e + 10, true), cdSize = v.getUint32(e + 12, true), cdOff = v.getUint32(e + 16, true);
  assert.equal(cdOff + cdSize, e, 'central directory ends where the end record starts');
  const files = []; let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), time = v.getUint16(p + 12, true), date = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true), nlen = v.getUint16(p + 28, true), loff = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    assert.equal(v.getUint32(loff, true), 0x04034b50, 'local header where the directory says');
    const lnlen = v.getUint16(loff + 26, true), lxlen = v.getUint16(loff + 28, true);
    const data = bytes.subarray(loff + 30 + lnlen + lxlen, loff + 30 + lnlen + lxlen + size);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    assert.equal(method, 0); assert.ok(flags & 0x0800, 'UTF-8 flag');
    files.push({ name, data: Uint8Array.from(data), time, date });
    p += 46 + nlen;
  }
  return files;
}
const jpeg = new Uint8Array(readFileSync(new URL('./a.jpg', import.meta.url)));
const noise = Uint8Array.from({ length: 70000 }, (_, i) => (i * 131 + (i >> 3)) & 255); // bigger than 64 KiB
const entries = [
  { name: 'Guide-X/Guide-X.md', data: '# Café — 日本語 😀\n\nLine two.\n' },
  { name: 'Guide-X/images/step-01.jpg', data: jpeg },
  { name: 'Guide-X/images/step-02.bin', data: noise },
  { name: 'Guide-X/empty.txt', data: '' },
  { name: 'Guide-X/日本語/ünï.txt', data: 'unicode path' },
];
const when = new Date(2026, 9, 20, 10, 30, 42);
const zip = buildZip(entries, when);
const files = readZip(zip);
assert.deepEqual(files.map((f) => f.name), entries.map((e) => e.name));
assert.equal(new TextDecoder().decode(files[0].data), entries[0].data);
assert.deepEqual([...files[1].data], [...jpeg], 'a screenshot survives byte for byte');
assert.deepEqual([...files[2].data], [...noise]);
assert.equal(files[3].data.length, 0);
const f = files[0];
assert.deepEqual([(f.date >> 9) + 1980, (f.date >> 5) & 15, f.date & 31, f.time >> 11, (f.time >> 5) & 63, (f.time & 31) * 2], [2026, 10, 20, 10, 30, 42], 'timestamp');
console.log('ok  round trip: text, binary, empty and unicode-named files');

// ---- independent tools accept it -----------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'zip-'));
const path = join(dir, 'out.zip');
writeFileSync(path, zip);
let ran = 0;
if (spawnSync('unzip', ['-v']).status !== null && spawnSync('unzip', ['-v']).error === undefined) {
  const t = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
  assert.equal(t.status, 0, `unzip -t failed:\n${t.stdout}${t.stderr}`);
  assert.match(t.stdout, /No errors detected/);
  const p = spawnSync('unzip', ['-p', path, 'Guide-X/images/step-01.jpg']);
  assert.deepEqual([...p.stdout], [...jpeg], 'unzip extracts identical bytes');
  ran++;
}
if (spawnSync('python3', ['-c', '1']).status === 0) {
  const py = spawnSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names = z.namelist(); assert names[0] == 'Guide-X/Guide-X.md', names
assert z.read('Guide-X/Guide-X.md').decode('utf-8').startswith('# Café'), 'utf-8 content'
assert 'Guide-X/日本語/ünï.txt' in names, 'utf-8 names'
print('python zipfile ok')`, path], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  ran++;
}
rmSync(dir, { recursive: true, force: true });
console.log(`ok  independent readers accept the archive (${ran} of 2 available here)`);

// an empty archive is still valid
const empty = readZip(buildZip([]));
assert.equal(empty.length, 0);
console.log('ok  an empty archive is valid');

console.log('\nzip tests passed');
