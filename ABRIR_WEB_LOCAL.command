#!/bin/bash
cd "$(dirname "$0")"
PORT=8765
echo ""
echo "==============================="
echo " DJGEEORGE PLAYER — LOCAL"
echo "==============================="
echo ""
echo "La web se va a abrir en tu navegador."
echo "Para cerrar el servidor: vuelve a esta ventana y pulsa CTRL+C."
echo ""

python3 -m http.server $PORT --bind 127.0.0.1 >/tmp/djgeeorge_player_server.log 2>&1 &
SERVER_PID=$!
sleep 1
open "http://127.0.0.1:$PORT"
trap "kill $SERVER_PID 2>/dev/null" EXIT
wait $SERVER_PID
