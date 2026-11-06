@echo off
rem MBIRA UI launcher — serves the reconciled Web UI and opens it in your browser.
rem Leave this window open; close it (or Ctrl+C) to stop serving.
cd /d "%~dp0"
start "" http://127.0.0.1:8766/ui/index.html
python -m http.server 8766 --bind 127.0.0.1
pause