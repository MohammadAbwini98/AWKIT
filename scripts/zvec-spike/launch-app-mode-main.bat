@echo off
cd /d "%~dp0..\.."
set AWKIT_ZVEC_SPIKE_HOST=main
start "" "dist\win-unpacked\SpecterStudio.exe"
