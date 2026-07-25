@echo off
cd /d "%~dp0..\.."
set ZVEC_SPIKE_CHECKPOINT_FILE=%~dp0.gui-checkpoint.log
"node_modules\.bin\electron.cmd" "scripts\zvec-spike\mainHostEntry.mjs" > "%~dp0.gui-main-host.log" 2>&1
echo DONE > "%~dp0.gui-main-host.done"
