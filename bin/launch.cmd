@echo off
rem AI-Portable launcher, called by Install.bat. No PowerShell: only cmd and tools every Windows 10/11 has
rem (curl.exe, certutil, tar.exe). It points the user, temp and app-data folders into this drive, fetches Node.js onto the drive on
rem the first start (checked against its published SHA-256), then hands over to bin\setup.mjs, which sets up the rest on one screen.
setlocal
set "AIP=%~dp0.."
for %%i in ("%AIP%") do set "AIP=%%~fi"

set "WORKDIR=%~1"

if not exist "%AIP%\home\temp" mkdir "%AIP%\home\temp"
if not exist "%AIP%\home\localappdata" mkdir "%AIP%\home\localappdata"
if not exist "%AIP%\home\appdata" mkdir "%AIP%\home\appdata"
set "USERPROFILE=%AIP%\home"
set "HOME=%AIP%\home"
set "LOCALAPPDATA=%AIP%\home\localappdata"
set "APPDATA=%AIP%\home\appdata"
set "TEMP=%AIP%\home\temp"
set "TMP=%AIP%\home\temp"
set "npm_config_cache=%AIP%\home\npm-cache"
set "NODE_REPL_HISTORY="
cd /d "%AIP%\home"
title AI-Portable

rem a .bat cannot have an icon: put an "AI-Portable" shortcut with the logo next to it (made right away, before any download)
if exist "%AIP%\bin\logo.ico" if not exist "%AIP%\Start.lnk" powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%AIP%\Start.lnk'); $s.TargetPath='%AIP%\Install.bat'; $s.WorkingDirectory='%AIP%'; $s.IconLocation='%AIP%\bin\logo.ico'; $s.Save()" >nul 2>&1

set "NODE=%AIP%\node\node.exe"
if exist "%NODE%" goto run

set "NODEVER=v26.13.0"
set "NODESHA=dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a"
set "NODEZIP=node-%NODEVER%-win-x64.zip"
set "PART=%AIP%\node.zip.part"
set "CURL=%SystemRoot%\System32\curl.exe"
set "TAR=%SystemRoot%\System32\tar.exe"
rem (AIP_TAR: a test stand-in for tar.exe, used only when set)
if defined AIP_TAR set "TAR=%AIP_TAR%"
if not exist "%CURL%" goto oldwindows
if not exist "%TAR%" goto oldwindows

if exist "%AIP%\bin\logo.txt" type "%AIP%\bin\logo.txt"
echo.
echo   First start: setting up on this drive (nothing goes on the PC)
echo.
echo   Getting Node.js %NODEVER% (39 MB) ...
rem the official site first; if it gives less than 1 MB/s for 10 s, the npmmirror CDN carries on from where it stopped
"%CURL%" -fL -# -C - --retry 2 --speed-limit 1048576 --speed-time 10 -o "%PART%" "https://nodejs.org/dist/%NODEVER%/%NODEZIP%"
if not errorlevel 1 goto verify
echo   The official site is slow or unreachable: continuing from a mirror ...
"%CURL%" -fL -# -C - --retry 3 -o "%PART%" "https://cdn.npmmirror.com/binaries/node/%NODEVER%/%NODEZIP%"
if errorlevel 1 goto netfail

:verify
echo   Checking it against the published SHA-256 ...
set "HASH="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%PART%" SHA256') do if not defined HASH set "HASH=%%h"
if defined HASH set "HASH=%HASH: =%"
if /i not "%HASH%"=="%NODESHA%" goto badhash

echo   Unpacking ...
set "UNPACK=%AIP%\home\temp\node-unpack"
if exist "%UNPACK%" rd /s /q "%UNPACK%"
mkdir "%UNPACK%"
call "%TAR%" -xf "%PART%" -C "%UNPACK%"
if errorlevel 1 goto unpackfail
move "%UNPACK%\node-%NODEVER%-win-x64" "%AIP%\node" >nul
if errorlevel 1 goto unpackfail
rd /s /q "%UNPACK%"
del "%PART%"

:run
"%NODE%" "%AIP%\bin\setup.mjs" "%WORKDIR%"
exit /b %errorlevel%

:oldwindows
echo.
echo   This needs Windows 10 (April 2018 update or newer) or Windows 11: curl.exe and tar.exe were not found.
goto stop
:netfail
echo.
echo   Node.js could not be downloaded. Check the internet connection and run Install.bat again;
echo   it continues from where it stopped.
goto stop
:badhash
del "%PART%"
echo.
echo   The downloaded Node.js did not match its published checksum, so it was deleted. Run Install.bat again.
goto stop
:unpackfail
echo.
echo   Node.js could not be unpacked onto this drive (is it full, or write-protected?).
goto stop
:stop
echo.
pause
exit /b 1
