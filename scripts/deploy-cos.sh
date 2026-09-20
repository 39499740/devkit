#!/usr/bin/env bash
# DevKit · 生成静态产物并同步到腾讯云 COS
# 依赖：coscli（腾讯云官方 CLI）已配置好 bucket 与密钥
#   brew install tencentcloud/tools/coscli && coscli config init
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/devkit/.output/public"
BUCKET="${COS_BUCKET:?请设置环境变量 COS_BUCKET，如 COS_BUCKET=devkit-1250000000}"

echo "==> 1/3 生成静态产物"
cd "$ROOT/devkit"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  npm run generate
else
  echo "    (SKIP_BUILD=1，跳过构建)"
fi

[ -f "$OUT/index.html" ] || { echo "缺少 $OUT/index.html，构建失败？"; exit 1; }

echo "==> 2/3 同步到 cos://$BUCKET"
# 先同步不变资源（长缓存），再同步入口文件（短缓存），最后删除远端多余文件
coscli sync "$OUT/_nuxt/" "cos://$BUCKET/_nuxt/" --delete --cache-control "public, max-age=31536000, immutable"
coscli sync "$OUT/" "cos://$BUCKET/" --delete --exclude "^_nuxt/" --cache-control "public, max-age=300"

echo "==> 3/3 完成"
echo "    核对：CO\(S\) 静态网站 索引文档=index.html，错误文档=index.html，错误文档响应码=200"
