// ระบบสรุปตารางทีมติดตั้ง (ดูอย่างเดียว)
// อ่านข้อมูลจาก Google Sheet (แบบ htmlview เพื่อให้ได้ merged cells และสี) แล้วส่งเป็น JSON ให้หน้าเว็บ
// รัน: node server.js  แล้วเปิด http://localhost:4000

const http = require('http');
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.SHEET_ID || '1Ua0PjuiFTF9my5vl1wBMCfVpOlO3ogy2Xw4LWmX2IEc';
const PORT = Number(process.env.PORT) || 4000;
const CACHE_MS = 5 * 60 * 1000;
const CACHE_FILE = path.join(__dirname, 'data-cache.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const THAI_MONTHS = {
  'มค': 1, 'กพ': 2, 'มีค': 3, 'เมย': 4, 'พค': 5, 'มิย': 6,
  'กค': 7, 'สค': 8, 'กย': 9, 'ตค': 10, 'พย': 11, 'ธค': 12,
};

let cache = null; // { at, data }
let inflight = null;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 scheduleIM' } });
  if (!res.ok) throw new Error(`โหลดไม่สำเร็จ ${res.status}: ${url}`);
  return res.text();
}

function decode(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

const clean = (s) => decode(s).replace(/\s+/g, ' ').trim();

// ชื่อแท็บ เช่น "ตค 2569" -> { year: 2026, month: 10 }
function parseMonthName(name) {
  const m = name.replace(/\./g, '').match(/(มค|กพ|มีค|เมย|พค|มิย|กค|สค|กย|ตค|พย|ธค)\s*(\d{4})/);
  if (!m) return null;
  let year = Number(m[2]);
  if (year > 2400) year -= 543;
  return { year, month: THAI_MONTHS[m[1]] };
}

function parseClassColors(html) {
  const colors = {};
  for (const m of html.matchAll(/\.(s\d+)\{([^}]*)\}/g)) {
    const bg = m[2].match(/background-color:(#[0-9a-fA-F]{3,6})/);
    if (bg) colors[m[1]] = bg[1].toLowerCase();
  }
  return colors;
}

// แปลงตาราง htmlview เป็น grid โดยคำนึงถึง colspan/rowspan
function parseGrid(html) {
  const start = html.indexOf('<table');
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end);
  const grid = []; // grid[r][c] = { text, cls, origin: bool, span }
  const pending = {}; // rowspan carry: pending[r][c] = cell
  let r = 0;
  for (const rowHtml of table.split(/<tr\b/).slice(1)) {
    if (!/<th[^>]*id="\d+R\d+"/.test(rowHtml)) continue; // แถว freeze bar / หัวคอลัมน์
    const row = [];
    let c = 0;
    const occupy = () => { while (pending[r] && pending[r][c]) { row[c] = pending[r][c]; c++; } };
    for (const m of rowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)) {
      const attrs = m[1];
      if (/freezebar-cell/.test(attrs)) continue;
      occupy();
      const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
      const colspan = Number((attrs.match(/colspan="(\d+)"/) || [])[1] || 1);
      const rowspan = Number((attrs.match(/rowspan="(\d+)"/) || [])[1] || 1);
      const cell = { text: clean(m[2]), cls, span: colspan };
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          const ref = { ...cell, origin: dr === 0 && dc === 0 };
          if (dr === 0) row[c + dc] = ref;
          else ((pending[r + dr] ||= {})[c + dc] = ref);
        }
      }
      c += colspan;
    }
    occupy();
    grid.push(row);
    r++;
  }
  return grid;
}

function parseMonthSheet(html, meta) {
  const colors = parseClassColors(html);
  const grid = parseGrid(html);
  if (!grid.length) return null;

  // หาแถวหัวที่มีเลขวันที่ 1..N
  const headerIdx = grid.findIndex((row) => row.filter((c) => c && /^\d{1,2}$/.test(c.text)).length >= 28);
  if (headerIdx < 0) return null;
  const header = grid[headerIdx];
  const dayCols = [];
  header.forEach((cell, ci) => {
    if (ci >= 4 && cell && /^\d{1,2}$/.test(cell.text)) {
      dayCols.push({ col: ci, day: Number(cell.text), bg: colors[cell.cls] || '#ffffff' });
    }
  });

  const pad = (n) => String(n).padStart(2, '0');
  const days = dayCols.map((d) => ({
    day: d.day,
    date: `${meta.year}-${pad(meta.month)}-${pad(d.day)}`,
    holiday: d.bg !== '#ffffff',
  }));

  const people = [];
  for (let ri = headerIdx + 1; ri < grid.length; ri++) {
    const row = grid[ri];
    const name = row[2] && row[2].text;
    if (!name) continue;
    const cells = dayCols.map((d) => {
      const cell = row[d.col];
      const site = cell && cell.text ? cell.text : null;
      return site ? { site, color: colors[cell.cls] || null } : null;
    });
    people.push({
      no: row[0] ? row[0].text : '',
      prefix: row[1] ? row[1].text : '',
      name,
      nick: row[3] ? row[3].text : '',
      cells,
    });
  }
  return { name: meta.name, gid: meta.gid, year: meta.year, month: meta.month, days, people };
}

async function loadAll() {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`;
  const index = await fetchText(base);
  const tabs = [];
  for (const m of index.matchAll(/name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g)) {
    const name = JSON.parse(`"${m[1]}"`);
    const ym = parseMonthName(name);
    if (ym) tabs.push({ name, gid: m[2], ...ym });
  }
  if (!tabs.length) throw new Error('ไม่พบแท็บรายเดือนใน Google Sheet');

  const months = (await Promise.all(tabs.map(async (t) => {
    const html = await fetchText(`${base}/sheet?headers=true&gid=${t.gid}`);
    return parseMonthSheet(html, t);
  }))).filter(Boolean);

  months.sort((a, b) => a.year - b.year || a.month - b.month);
  return {
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    updatedAt: new Date().toISOString(),
    months,
  };
}

async function getData(force) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = loadAll()
      .then((data) => {
        cache = { at: Date.now(), data };
        fs.writeFile(CACHE_FILE, JSON.stringify(data), () => {});
        return data;
      })
      .catch((err) => {
        console.error(err.message);
        if (cache) return { ...cache.data, stale: true, error: err.message };
        if (fs.existsSync(CACHE_FILE)) {
          const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
          return { ...data, stale: true, error: err.message };
        }
        throw err;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function startServer() {
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }

  if (url.pathname === '/api/data') {
    try {
      const data = await getData(url.searchParams.has('refresh'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // sw.js: ใส่เลขเวอร์ชันจากเวลาแก้ไขไฟล์ในเครื่อง -> แอปที่ติดตั้งจาก localhost อัปเดตเองเหมือนบน GitHub Pages
    if (path.basename(file) === 'sw.js') {
      const stamp = ['index.html', 'sw.js', 'config.js'].map((f) => { try { return fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs; } catch { return 0; } });
      buf = Buffer.from(buf.toString('utf8').replace('__BUILD__', 'local-' + Math.max(...stamp).toString(36)));
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`ระบบสรุปตารางทีมติดตั้ง: http://localhost:${PORT}`));
}

if (require.main === module) startServer();
module.exports = { loadAll };
