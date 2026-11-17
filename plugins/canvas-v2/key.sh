#!/bin/sh
# Canvas's key for this computer. Claude runs this when it connects to the canvas, and sends what it prints with every
# call, so nobody signs in to start: the first time, it asks the canvas for a key (no browser, no account) and keeps it
# in ~/.config/usecanvas, readable only by you. Signing in on the canvas later moves everything to your account.
# If the canvas can't be reached, it prints no key, and Claude asks you to connect in the browser instead.
origin="${1:-https://canvas-v2.ac0.app}"
dir="${XDG_CONFIG_HOME:-$HOME/.config}/usecanvas"
file="$dir/$(printf '%s' "$origin" | sed 's#^[a-z]*://##; s#[^A-Za-z0-9.-]#_#g').key"
if [ ! -s "$file" ]; then
  key=$(curl -fsS --max-time 15 -X POST -H 'content-type: application/json' --data '{"client":"Claude Code"}' "$origin/api/device" 2>/dev/null \
    | sed -n 's/.*"key":"\([A-Za-z0-9._-]*\)".*/\1/p')
  if [ -z "$key" ]; then printf '{}'; exit 0; fi
  umask 077; mkdir -p "$dir" && printf '%s' "$key" > "$file.$$" && mv "$file.$$" "$file"
fi
printf '{"Authorization":"Bearer %s"}' "$(cat "$file")"
