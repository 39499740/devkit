#!/usr/bin/env bash
# DevKit · 生成静态产物并同步到腾讯云 COS
#
# 用法：
#   COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh
#   SKIP_BUILD=1 COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh   # 跳过构建，只同步现有产物
#
# coscli 查找顺序：$COSCLI → 仓库内 .tools/coscli → PATH 里的 coscli
# 配置查找顺序：$COS_CONFIG → ~/.cos.yaml
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/devkit/.output/public"
BUCKET="${COS_BUCKET:?请设置环境变量 COS_BUCKET，例如 COS_BUCKET=devkit-1250000000}"

# --- coscli ---
if [ -n "${COSCLI:-}" ]; then
  COSCLI="$COSCLI"
elif [ -x "$ROOT/.tools/coscli" ]; then
  COSCLI="$ROOT/.tools/coscli"
else
  COSCLI="$(command -v coscli || true)"
fi
if [ -z "$COSCLI" ] || [ ! -x "$COSCLI" ]; then
  echo "找不到 coscli。把官方二进制放到 $ROOT/.tools/coscli 即可（见 docs/DEPLOY-COS.md 第 3 节）"
  exit 1
fi

# --- 配置 ---
CONF="${COS_CONFIG:-$HOME/.cos.yaml}"
if [ ! -f "$CONF" ]; then
  echo "缺少 coscli 配置文件：$CONF"
  echo "先生成一份（交互式填 secretId / secretKey / bucket=${BUCKET}）："
  echo "  $COSCLI -c $CONF config init"
  exit 1
fi

echo "==> 1/3 生成静态产物"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  ( cd "$ROOT/devkit" && npm run generate )
else
  echo "    (SKIP_BUILD=1，跳过构建)"
fi
[ -f "$OUT/index.html" ] || { echo "缺少 $OUT/index.html，构建失败？"; exit 1; }

echo "==> 2/3 同步到 cos://$BUCKET"
# 带 hash 的构建产物长缓存；入口文件（html / sw.js / manifest / robots / sitemap）短缓存，保证发版即生效
"$COSCLI" -c "$CONF" sync "$OUT/_nuxt/" "cos://$BUCKET/_nuxt/" \
  -r --delete --force --meta "Cache-Control:public, max-age=31536000, immutable"
"$COSCLI" -c "$CONF" sync "$OUT/" "cos://$BUCKET/" \
  -r --delete --force --exclude "^_nuxt/" --meta "Cache-Control:public, max-age=300"

echo "==> 3/3 完成"
echo "    别忘了在 COS 控制台核对静态网站：索引文档=index.html，错误文档=index.html，错误文档响应码=200"
