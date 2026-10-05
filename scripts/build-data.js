// สร้างไฟล์ข้อมูล static สำหรับ GitHub Pages
// รัน: node scripts/build-data.js [ไฟล์ปลายทาง]   (ค่าเริ่มต้น public/data.json)

const fs = require('fs');
const path = require('path');
const { loadAll } = require('../server');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'public', 'data.json'));

loadAll()
  .then((data) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(data));
    const people = data.months.reduce((n, m) => Math.max(n, m.people.length), 0);
    console.log(`เขียน ${out}: ${data.months.map((m) => m.name).join(', ')} (${people} คน)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
