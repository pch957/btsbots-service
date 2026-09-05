#!/usr/bin/env bash
set -e

PORT=${1:-1420}

echo "=========================================================="
echo "🚀 正在启动 BTSBots Service 开发服务器 (Port: $PORT)..."
echo "=========================================================="

if [ ! -d "node_modules" ]; then
    echo "📦 正在安装依赖..."
    npm install
fi

export VITE_PORT=$PORT
npx vite --port $PORT --host 0.0.0.0
