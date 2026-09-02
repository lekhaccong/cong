@echo off
setlocal
cd /d "%~dp0"
echo Dung cua so may chu bang Ctrl+C truoc khi khoi phuc.
set /p "backup_path=Nhap duong dan day du den file .sqlite (khong kem dau ngoac kep): "
set /p "confirm=Nhap KHOIPHUC de xac nhan thay du lieu hien tai: "
if not "%confirm%"=="KHOIPHUC" exit /b 1
node restore.mjs "%backup_path%" --confirm
pause
