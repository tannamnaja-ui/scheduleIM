@echo off
chcp 65001 >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000 " ^| findstr LISTENING') do taskkill /PID %%p /F
echo หยุดเซิร์ฟเวอร์แล้ว
timeout /t 2 >nul