#!/bin/bash
# Live HTTP header + injection check. Usage: test/headers.sh https://pulsebasis.netlify.app
B=${1:-https://pulsebasis.netlify.app}; bad=0
for p in / /stats; do H=$(curl -sI "$B$p?h=$RANDOM"); B2=$(curl -s "$B$p?h=$RANDOM")
  for want in "content-security-policy:.*frame-ancestors 'none'" "x-content-type-options: nosniff" "referrer-policy: no-referrer" "permissions-policy: camera=()"; do
    if echo "$H" | grep -qiE "$want"; then echo "PASS $p $want"; else echo "FAIL $p $want"; bad=1; fi; done
  if echo "$B2" | grep -qE "netlify/scripts|<!--"; then echo "FAIL $p injected script/comment"; bad=1; else echo "PASS $p no injected script or HTML comments"; fi
done; [ $bad = 0 ] && echo ALL PASSED || echo FAILED
