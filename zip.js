// Minimal, dependency-free ZIP writer. Entries are stored without compression: screenshots are already JPEG
// (compressing them again gains nothing) and the text files are small. Pure functions, so it runs under Node for tests.
//
//   buildZip([{ name: 'folder/file.md', data: 'text' | Uint8Array }], when?) -> Uint8Array
//
// File names are UTF-8 (flag bit 11). Names are validated, because a ZIP that writes outside its own folder when
// unpacked ("zip slip") is a real attack.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

function dosDateTime(d) {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function isSafeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length < 1024
    && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !/^[A-Za-z]:/.test(name)
    && !name.split('/').some((part) => part === '..' || part === '');
}

export function buildZip(entries, when = new Date()) {
  if (entries.length > 0xffff) throw new Error('Too many files for a ZIP');
  const { time, date } = dosDateTime(when);
  const seen = new Set();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    if (!isSafeName(entry.name)) throw new Error(`Unsafe file name in ZIP: ${JSON.stringify(entry.name)}`);
    if (seen.has(entry.name)) throw new Error(`Duplicate file name in ZIP: ${entry.name}`);
    seen.add(entry.name);

    const name = encoder.encode(entry.name);
    const data = toBytes(entry.data);
    if (data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('ZIP too large');
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header signature
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // flags: UTF-8 names
    local.setUint16(8, 0, true);            // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);           // no extra field
    parts.push(new Uint8Array(local.buffer), name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);     // central directory signature
    dir.setUint16(4, 0x031e, true);         // made by: Unix, spec 3.0
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint16(30, 0, true);             // extra
    dir.setUint16(32, 0, true);             // comment
    dir.setUint16(34, 0, true);             // disk
    dir.setUint16(36, 0, true);             // internal attributes
    dir.setUint32(38, (0o100644 << 16) >>> 0, true); // external attributes: a regular file, rw-r--r--
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}
