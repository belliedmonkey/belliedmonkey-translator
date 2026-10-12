#!/bin/bash
set -e

echo "========================================="
echo "   Google Antigravity CLI (agy) 一键配置"
echo "========================================="

# 1. 检查并安装 agy
if ! command -v agy &> /dev/null && [ ! -f "$HOME/.local/bin/agy" ]; then
    echo "==> 正在下载安装 agy..."
    curl -fsSL https://antigravity.google/cli/install.sh | bash
else
    echo "==> agy 已存在。"
fi

# 2. 写入 PATH 到 ~/.zshrc
if ! grep -qs 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.zshrc"; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
    echo "==> 已将 ~/.local/bin 添加到 ~/.zshrc"
else
    echo "==> ~/.zshrc 中已存在 PATH 配置"
fi
export PATH="$HOME/.local/bin:$PATH"

# 3. 设置终端代理（适配 Shadowrocket 常用本地端口 1087，可根据实际情况修改）
PROXY_PORT=${1:-1087}
echo "==> 设置当前终端代理为 http://127.0.0.1:$PROXY_PORT"
export http_proxy="http://127.0.0.1:$PROXY_PORT"
export https_proxy="http://127.0.0.1:$PROXY_PORT"
export all_proxy="socks5://127.0.0.1:$PROXY_PORT"

# 4. 测试网络与启动授权
echo "==> 正在测试与 Google 服务器连接..."
if curl -I -s --connect-timeout 5 https://antigravity.google > /dev/null 2>&1 || curl -I -s --connect-timeout 5 https://www.google.com > /dev/null 2>&1; then
    echo "==> 网络连接正常！"
else
    echo "⚠️ 警告: 无法连通 Google，请确认 Shadowrocket 是否已开启且本地端口为 $PROXY_PORT。"
    echo "   如果使用其他端口，请重新运行: bash setup-agy.sh <端口号>"
fi

echo "========================================="
echo "==> 启动 agy 进行 Google 账号授权登录..."
echo "========================================="
agy auth login
