/**
 * API สำหรับแอปตารางทีมติดตั้ง — ส่งข้อมูลจาก Google Sheet แบบสด (ดูอย่างเดียว)
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 *   1. เปิด https://script.google.com → New project → วางโค้ดนี้แทนของเดิม → Save
 *   2. Deploy → New deployment → ประเภท "Web app"
 *        Execute as: Me   |   Who has access: Anyone
 *   3. กด Deploy → อนุญาตสิทธิ์ → คัดลอก Web app URL (ลงท้าย /exec) ไปใส่ใน public/config.js
 *
 * ผลลัพธ์มีรูปแบบเดียวกับ data.json ที่ server.js / GitHub Actions สร้าง
 */

const SHEET_ID = '1Ua0PjuiFTF9my5vl1wBMCfVpOlO3ogy2Xw4LWmX2IEc';
const CACHE_SECONDS = 20; // กันการอ่าน Sheet ถี่เกินไปเมื่อมีหลายคนเปิดแอปพร้อมกัน

const THAI_MONTHS = { 'มค': 1, 'กพ': 2, 'มีค': 3, 'เมย': 4, 'พค': 5, 'มิย': 6, 'กค': 7, 'สค': 8, 'กย': 9, 'ตค': 10, 'พย': 11, 'ธค': 12 };

function doGet() {
  const cache = CacheService.getScriptCache();
  let json = null;
  const hit = cache.get('data');
  if (hit) {
    json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(hit), 'application/x-gzip')).getDataAsString('UTF-8');
  } else {
    json = JSON.stringify(buildData());
    const packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes());
    if (packed.length < 95000) cache.put('data', packed, CACHE_SECONDS);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function parseMonthName(name) {
  const m = name.replace(/\./g, '').match(/(มค|กพ|มีค|เมย|พค|มิย|กค|สค|กย|ตค|พย|ธค)\s*(\d{4})/);
  if (!m) return null;
  let year = Number(m[2]);
  if (year > 2400) year -= 543;
  return { year: year, month: THAI_MONTHS[m[1]] };
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function buildData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const months = [];
  ss.getSheets().forEach((sheet) => {
    const ym = parseMonthName(sheet.getName());
    if (!ym) return;
    const m = parseSheet(sheet, ym);
    if (m) months.push(m);
  });
  months.sort((a, b) => a.year - b.year || a.month - b.month);
  return {
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit',
    updatedAt: new Date().toISOString(),
    source: 'apps-script',
    months: months,
  };
}

function parseSheet(sheet, ym) {
  const rows = sheet.getLastRow(), cols = sheet.getLastColumn();
  if (rows < 2 || cols < 5) return null;
  const range = sheet.getRange(1, 1, rows, cols);
  const values = range.getDisplayValues();
  const bgs = range.getBackgrounds();

  // กระจายค่า/สีของ merged cell ไปทุกช่องที่ถูก merge (เหมือน colspan ในหน้าเว็บ)
  range.getMergedRanges().forEach((mr) => {
    const r0 = mr.getRow() - 1, c0 = mr.getColumn() - 1;
    const v = values[r0][c0], bg = bgs[r0][c0];
    for (let r = r0; r < r0 + mr.getNumRows(); r++) {
      for (let c = c0; c < c0 + mr.getNumColumns(); c++) {
        if (r < rows && c < cols) { values[r][c] = v; bgs[r][c] = bg; }
      }
    }
  });

  const headerIdx = values.findIndex((row) => row.filter((v) => /^\d{1,2}$/.test(clean(v))).length >= 28);
  if (headerIdx < 0) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const dayCols = [];
  values[headerIdx].forEach((v, c) => {
    if (c >= 4 && /^\d{1,2}$/.test(clean(v))) dayCols.push({ col: c, day: Number(clean(v)), bg: String(bgs[headerIdx][c]).toLowerCase() });
  });

  const days = dayCols.map((d) => ({
    day: d.day,
    date: ym.year + '-' + pad(ym.month) + '-' + pad(d.day),
    holiday: d.bg !== '#ffffff',
  }));

  const people = [];
  for (let r = headerIdx + 1; r < rows; r++) {
    const row = values[r];
    const name = clean(row[2]);
    if (!name) continue;
    people.push({
      no: clean(row[0]),
      prefix: clean(row[1]),
      name: name,
      nick: clean(row[3]),
      cells: dayCols.map((d) => {
        const site = clean(row[d.col]);
        return site ? { site: site, color: String(bgs[r][d.col]).toLowerCase() } : null;
      }),
    });
  }
  return { name: sheet.getName(), gid: String(sheet.getSheetId()), year: ym.year, month: ym.month, days: days, people: people };
}
