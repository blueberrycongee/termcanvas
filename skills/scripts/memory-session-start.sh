#!/bin/bash
# memory-session-start.sh
# Fetch enhanced memory index from TermCanvas API and inject as additionalContext.

PORT_FILE="${TERMCANVAS_PORT_FILE:-$HOME/.termcanvas/port}"
PORT=$(cat "$PORT_FILE" 2>/dev/null || echo "")
if [ -z "$PORT" ]; then
  exit 0
fi

# Determine worktree from CWD
WORKTREE=$(pwd)

ENCODED=$(printf '%s' "$WORKTREE" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=''))" 2>/dev/null)
RESP=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/memory/index?worktree=$ENCODED" 2>/dev/null)
if [ -z "$RESP" ]; then
  exit 0
fi

INDEX=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('index',''))" 2>/dev/null)
if [ -z "$INDEX" ]; then
  exit 0
fi

# Return additionalContext format
python3 -c "
import json, sys
index = sys.stdin.read()
print(json.dumps({
  'hookSpecificOutput': {
    'hookEventName': 'SessionStart',
    'additionalContext': index
  }
}))
" <<< "$INDEX"
