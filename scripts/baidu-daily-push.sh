#!/usr/bin/env bash
# 百度主动推送的每日任务（供 launchd 调用，见 scripts/launchd/com.dsh.baidu-push.plist）
#
# 为什么需要它：百度新站 API 配额是 10 条/天，而模型/人不可能天天记得手动跑。
# 脚本每天推 10 条未推过的 URL（游标在 .tools/baidu-pushed.json），推完自动停止。
#
# token 来源（按优先级）：
#   1. 环境变量 BAIDU_PUSH_TOKEN
#   2. .tools/baidu-token（600 权限，已被 .gitignore 忽略，与 .tools/cos.yaml 同一套本地密钥约定）
# 日志：.tools/logs/baidu-push-<日期>.log
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# launchd 的 PATH 很干净，必须用绝对路径；换 node 版本时用 NODE_BIN 覆盖
NODE="${NODE_BIN:-/Users/hao/.version-fox/sdks/nodejs/bin/node}"
export BAIDU_PUSH_LIMIT="${BAIDU_PUSH_LIMIT:-10}"

LOG_DIR="$ROOT/.tools/logs"
LOG="$LOG_DIR/baidu-push-$(date +%F).log"
mkdir -p "$LOG_DIR"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

if [ -z "${BAIDU_PUSH_TOKEN:-}" ] && [ -f "$ROOT/.tools/baidu-token" ]; then
  BAIDU_PUSH_TOKEN="$(tr -d '[:space:]' <"$ROOT/.tools/baidu-token")"
fi
if [ -z "${BAIDU_PUSH_TOKEN:-}" ]; then
  log "缺少 token：既没有环境变量 BAIDU_PUSH_TOKEN，也没有 $ROOT/.tools/baidu-token"
  exit 1
fi
export BAIDU_PUSH_TOKEN

if [ ! -x "$NODE" ]; then
  log "找不到可执行的 node：$NODE（用 NODE_BIN=/path/to/node 覆盖）"
  exit 1
fi

# 百度侧会出现瞬时错误（实测 2026-09-24 10:00 返回 505 please retry later），
# 而配额「当天不用即作废」——只试一次等于把这一天的 10 条彻底丢掉，所以失败要退避重试。
ATTEMPTS="${BAIDU_PUSH_ATTEMPTS:-3}"
RETRY_DELAY="${BAIDU_PUSH_RETRY_DELAY:-60}"

attempt=1
while :; do
  out="$("$NODE" "$ROOT/scripts/baidu-push.mjs" 2>&1)"
  code=$?
  { echo "---- $(date '+%F %T') attempt=$attempt/$ATTEMPTS exit=$code ----"; printf '%s\n' "$out"; } >>"$LOG"

  # 配额用尽是预期情况（次日 0 点重置），不算失败，免得日志里天天是错误
  if printf '%s' "$out" | grep -q "over quota"; then
    log "配额用尽，跳过（次日自动重试）"
    exit 0
  fi

  # 0 = 推送成功；「没有待推 URL」也是 0，都不再重试
  if [ "$code" -eq 0 ]; then
    log "推送完成（第 $attempt 次尝试）"
    exit 0
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    log "第 $attempt 次尝试仍失败（exit=$code），本次放弃：当天配额作废，等下一次定时触发或次日继续"
    exit "$code"
  fi
  log "第 $attempt 次尝试失败（exit=$code），${RETRY_DELAY}s 后重试"
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done
