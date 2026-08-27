#!/bin/sh
# Run Forefront on its localhost origin, which is the setup every browser
# supports. Closing this terminal stops the local server; Forefront keeps
# working until you close the tab, and your data is already saved.
#
# Make it runnable once with:  chmod +x start-linux.sh
set -e
cd -- "$(dirname -- "$0")"

if command -v node >/dev/null 2>&1; then
  exec node tools/serve.js --open
fi

if command -v python3 >/dev/null 2>&1; then
  # Backgrounded and detached from this shell so the server still starts if no
  # desktop browser handler is configured.
  (command -v xdg-open >/dev/null 2>&1 && xdg-open http://127.0.0.1:8765/ >/dev/null 2>&1 &) || true
  exec python3 -m http.server 8765 --bind 127.0.0.1
fi

echo "Forefront needs Node.js or Python 3 to serve itself to your browser."
echo "Install either one, then run this file again."
exit 1
