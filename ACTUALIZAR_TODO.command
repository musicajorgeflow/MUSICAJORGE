#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "==================================="
echo " DJGEEORGE PLAYER — ACTUALIZAR JSON"
echo "==================================="
echo ""

if ! command -v python3 >/dev/null 2>&1; then
  echo "No encuentro Python 3 en este Mac."
  echo "Instala Python 3 desde python.org y vuelve a ejecutar este archivo."
  read -p "Pulsa ENTER para cerrar..."
  exit 1
fi

python3 tools/actualizar_todo.py

echo ""
read -p "Pulsa ENTER para cerrar..."
