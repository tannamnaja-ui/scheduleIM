// URL ของ Google Apps Script Web App (ลงท้ายด้วย /exec) — ดูวิธีตั้งค่าใน apps-script/Code.gs
// ถ้าใส่ไว้ แอปจะดึงข้อมูลสดจาก Google Sheet ทุก 1 นาที, ถ้าเว้นว่างจะใช้ data.json ที่ GitHub Actions สร้าง
window.SCHEDULE_API = 'https://script.google.com/macros/s/AKfycby4sM3r0MVbo8_tN_27-E9A6kI_LzOsSJmHzb8pmXSI3UrwHX-CsSM1XL8jQM2hV_4Q/exec';
