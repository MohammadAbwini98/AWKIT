@echo off
REM Phase 0C — packaged native-host health + CRUD against the staged extraResources tree.
cd /d "%~dp0..\.."
set AWKIT_ZVEC_SPIKE_HOST=native-host
start "" "dist\win-unpacked\SpecterStudio.exe"
