#!/bin/sh
# dsh-startup-screen —— 启动动画离线预览（macOS / Linux）
# 用法：./open-preview.sh   或者   sh open-preview.sh
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
PAGE="$HERE/preview/index.html"

if [ ! -f "$PAGE" ]; then
  echo "[x] 找不到预览页: $PAGE" >&2
  exit 1
fi

cat <<EOF

  dsh-startup-screen - 启动动画离线预览
  ------------------------------------------------
  预览页: $PAGE

  打开后:
    1) 自动播放一遍完整的启动动画
    2) 右上角控制台可改身份名称 / 权限等级 / 主题 / 速度
    3) 第 1、2 步需要点按钮或按 Enter 才会继续
    4) 右上角 SKIP 或 Esc 跳过; 点「设置面板预览」看 DSH 设置页里的样子

EOF

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$PAGE"
elif command -v open >/dev/null 2>&1; then
  open "$PAGE"
else
  echo "  没找到 xdg-open / open，请手动在浏览器里打开上面那个路径。"
fi
