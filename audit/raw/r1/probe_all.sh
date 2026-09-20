#!/bin/bash
cd /Users/hao/WebstormProjects/web_tools
mkdir -p audit/raw/r1/probes
P="python3 audit/tools/probe.py"
$P / --shot audit/raw/r1/probes/home.png > audit/raw/r1/probes/home.json 2>audit/raw/r1/probes/home.err
$P /category/format --shot audit/raw/r1/probes/cat-format.png > audit/raw/r1/probes/cat-format.json 2>audit/raw/r1/probes/cat-format.err
$P /category/java --shot audit/raw/r1/probes/cat-java.png > audit/raw/r1/probes/cat-java.json 2>audit/raw/r1/probes/cat-java.err
$P /favorites --shot audit/raw/r1/probes/favorites.png > audit/raw/r1/probes/favorites.json 2>audit/raw/r1/probes/favorites.err
$P /recent --shot audit/raw/r1/probes/recent.png > audit/raw/r1/probes/recent.json 2>audit/raw/r1/probes/recent.err
$P /settings --shot audit/raw/r1/probes/settings.png > audit/raw/r1/probes/settings.json 2>audit/raw/r1/probes/settings.err
$P /privacy --shot audit/raw/r1/probes/privacy.png > audit/raw/r1/probes/privacy.json 2>audit/raw/r1/probes/privacy.err
$P /help --shot audit/raw/r1/probes/help.png > audit/raw/r1/probes/help.json 2>audit/raw/r1/probes/help.err
$P /offline --shot audit/raw/r1/probes/offline.png > audit/raw/r1/probes/offline.json 2>audit/raw/r1/probes/offline.err
$P /tools/does-not-exist --shot audit/raw/r1/probes/404-tool.png > audit/raw/r1/probes/404-tool.json 2>audit/raw/r1/probes/404-tool.err
$P /category/nope --shot audit/raw/r1/probes/404-cat.png > audit/raw/r1/probes/404-cat.json 2>audit/raw/r1/probes/404-cat.err
$P /tools/sm4 --shot audit/raw/r1/probes/sm4.png > audit/raw/r1/probes/sm4.json 2>audit/raw/r1/probes/sm4.err
echo PROBE_ALL_DONE
