#!/usr/bin/env bash
# COS/CDN 用量体检的每日任务（供 launchd 调用，见 scripts/launchd/com.dsh.cos-usage.plist）
#
# 为什么需要它：站点走 CDN，但 CDN 之外的直连（访问 COS 默认域名）走的是单价更高的
# 「COS 外网下行流量」。每天自动体检一次，直连量或直连请求占比超阈值时退出码非 0、
# 日志里能看到告警，不用自己记得手动查。
#
# 密钥：环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY，或 .tools/cos.yaml（与 coscli 同一份）
# 日志：.tools/logs/cos-usage-<日期>.log（报告本身另有 .tools/logs/cos-usage-<日期>.md）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# launchd 的 PATH 很干净，必须用绝对路径；换 node 版本时用 NODE_BIN 覆盖
NODE="${NODE_BIN:-/Users/hao/.version-fox/sdks/nodejs/bin/node}"

LOG_DIR="$ROOT/.tools/logs"
LOG="$LOG_DIR/cos-usage-$(date +%F).log"
mkdir -p "$LOG_DIR"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

if [ ! -x "$NODE" ]; then
  log "找不到可执行的 node：$NODE（用 NODE_BIN=/path/to/node 覆盖）"
  exit 1
fi

out="$("$NODE" "$ROOT/scripts/cos-usage-report.mjs" --days 7 --hourly 2>&1)"
code=$?
{ echo "---- $(date '+%F %T') exit=$code ----"; printf '%s\n' "$out"; } >>"$LOG"
printf '%s\n' "$out" >&2
exit "$code"
