@echo off
cd /d "%~dp0..\.."
set AWKIT_ZVEC_SPIKE_HOST=utility
start "" "dist\win-unpacked\SpecterStudio.exe"
