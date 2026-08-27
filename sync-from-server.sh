#!/usr/bin/env bash
# ============================================================
# 朋友的酒 - 服务器模块 -> GitHub 仓库 一键同步
# 用法：bash sync-from-server.sh   （在 Git Bash 中执行）
# 作用：把 /e/rtt/server/public/friends-wine 的最新状态复制到
#       /e/financial-leverage/friends-wine，提交并推送到
#       https://github.com/paipai4/-financial-leverage
# 约定：每次修改模块代码后运行本脚本（有变更自动 commit+push）
# ============================================================
set -e

SRC="/e/rtt/server/public/friends-wine"
REPO="/e/financial-leverage"

if [ ! -d "$SRC" ]; then
    echo "[错误] 源目录不存在：$SRC"
    exit 1
fi
cd "$REPO"

echo "[1/3] 复制模块文件 ..."
if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$SRC/" "$REPO/friends-wine/"
else
    cp -a "$SRC/." "$REPO/friends-wine/"
fi
echo "      复制完成。"

echo "[2/3] 检查变更并提交 ..."
git add -A
if git diff --cached --quiet; then
    echo "      无内容变更，跳过提交。"
else
    git commit -m "sync: 服务器模块更新 $(date '+%Y-%m-%d %H:%M')"
    echo "      已提交。"
fi

echo "[3/3] 推送到 GitHub ..."
git push origin main
echo ""
echo "完成！仓库已与服务器模块同步。"