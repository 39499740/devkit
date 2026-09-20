#!/bin/bash
cd /Users/hao/WebstormProjects/web_tools
mkdir -p audit/raw/r1/probes
P="python3 audit/tools/probe.py"
for path in / /category/format /favorites /recent /settings /help /privacy /offline; do
  name=$(echo "$path" | tr '/' '_' ); [ -z "$name" ] && name=root
  $P "$path" --w 390 --h 844 > audit/raw/r1/probes/m${name}.json 2>/dev/null
  $P "$path" --w 1366 --h 768 > audit/raw/r1/probes/d${name}.json 2>/dev/null
done
# dark main pages
for path in / /category/format /favorites /settings /recent /privacy /help /offline; do
  name=$(echo "$path" | tr '/' '_' ); [ -z "$name" ] && name=root
  $P "$path" --dark > audit/raw/r1/probes/k${name}.json 2>/dev/null
done
$P / --dark --shot audit/raw/r1/probes/home-dark.png >/dev/null 2>&1
$P / --w 390 --h 844 --shot audit/raw/r1/probes/home-mobile.png >/dev/null 2>&1
echo RESP_DONE
