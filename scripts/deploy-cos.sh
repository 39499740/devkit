#!/usr/bin/env bash
# DevKit · 生成静态产物并同步到腾讯云 COS
#
# 用法：
#   COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh
#   SKIP_BUILD=1 COS_BUCKET=devkit-1250000000 scripts/deploy-cos.sh   # 跳过构建，只同步现有产物
#
# coscli 查找顺序：$COSCLI → 仓库内 .tools/coscli → PATH 里的 coscli
# 配置查找顺序：$COS_CONFIG → 仓库内 .tools/cos.yaml → ~/.cos.yaml
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
if [ -n "${COS_CONFIG:-}" ]; then
  CONF="$COS_CONFIG"
elif [ -f "$ROOT/.tools/cos.yaml" ]; then
  CONF="$ROOT/.tools/cos.yaml"
else
  CONF="$HOME/.cos.yaml"
fi
if [ ! -f "$CONF" ]; then
  echo "缺少 coscli 配置文件：$CONF"
  echo "先生成一份（交互式填 secretId / secretKey / bucket=${BUCKET}）："
  echo "  $COSCLI -c $CONF config init"
  exit 1
fi

echo "==> 1/4 生成静态产物"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  ( cd "$ROOT/devkit" && npm run generate )
else
  echo "    (SKIP_BUILD=1，跳过构建)"
fi
[ -f "$OUT/index.html" ] || { echo "缺少 $OUT/index.html，构建失败？"; exit 1; }

echo "==> 2/4 同步到 cos://$BUCKET"
# 带 hash 的构建产物长缓存（1 年 immutable）；入口文件（html / sw.js / manifest / robots / sitemap）1 小时。
# HTML 从 300s 提到 3600s：源站回源次数（= COS 回源流量计费项）能降一个量级，
# 代价是发版后必须刷新 CDN —— 见下面第 3 步，已默认自动执行。
sync_dir() {
  local src="$1" dst="$2" cc="$3"
  shift 3
  if ! "$COSCLI" -c "$CONF" sync "$src" "$dst" -r --delete --force \
      --meta "Cache-Control:$cc" "$@"; then
    echo
    echo "同步失败，逐项检查："
    echo "  1) $CONF 里的 secretid / secretkey 是否已换成真实密钥"
    echo "  2) 桶名 $BUCKET 是否存在、地域是否与建桶时一致"
    echo "  3) 该密钥是否有此桶的读写权限"
    exit 1
  fi
}
sync_dir "$OUT/_nuxt/" "cos://$BUCKET/_nuxt/" "public, max-age=31536000, immutable"
sync_dir "$OUT/" "cos://$BUCKET/" "public, max-age=3600" --exclude "^_nuxt/"

echo "==> 3/4 刷新 CDN 缓存"
# 入口文件缓存 1 小时，发版后不刷新就可能最多 1 小时拿到旧 HTML；刷新失败不阻断部署，只提示手动补
if [ "${PURGE:-1}" = "1" ]; then
  if ! node "$ROOT/scripts/cdn-purge.mjs"; then
    echo "    ⚠️ CDN 刷新失败（不影响本次上传）：稍后手动执行 node scripts/cdn-purge.mjs"
  fi
else
  echo "    (PURGE=0，跳过) —— 发版后请务必手动执行：node scripts/cdn-purge.mjs"
fi

echo "==> 4/4 完成"
echo "    别忘了在 COS 控制台核对静态网站：索引文档=index.html，错误文档=404.html（不要填 index.html；动态流程地址依赖它兜底成 SPA 外壳），错误文档响应码=404（或 200）"
