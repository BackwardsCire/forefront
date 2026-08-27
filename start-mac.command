#!/bin/zsh
# Double-click this file on macOS to run Forefront on its universally supported
# localhost origin. Closing the Terminal window stops the local server.
set -e

cd -- "$(dirname -- "$0")"

if command -v node >/dev/null 2>&1; then
  exec node tools/serve.js --open
fi

if command -v python3 >/dev/null 2>&1; then
  open http://127.0.0.1:8765/
  exec python3 -m http.server 8765 --bind 127.0.0.1
fi

osascript -e 'display dialog "Forefront needs Node.js or Python 3 to run in Safari and Firefox. Install either one, then double-click start-mac.command again." buttons {"OK"} default button "OK" with icon caution'
exit 1
