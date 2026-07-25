@echo off
cd /d "%~dp0..\.."
set AWKIT_ZVEC_SPIKE_HOST=utility-crash
start "" "dist\win-unpacked\SpecterStudio.exe"
