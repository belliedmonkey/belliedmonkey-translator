#!/bin/bash
# deploy/china/smtp-check.sh — 每小时一次：这台境内机器还连得上发信服务器（smtp.qq.com）吗？
#
# 2026-09-22 起发信走 QQ 邮箱（境内；原先的 Gmail 会把收件人邮箱带出境）。发信服务器在境内也可能断 ——
# 断了的样子是「用户收不到验证码」，而服务端日志里只是一行超时。这个脚本把它变成一个能看见的状态：
# 结果追加到 /var/log/bt-smtp-check.log，连续失败时在 /var/lib/bt/smtp-down 留一个标记文件
# （巡检读它；以后接告警也读它）。只做 TCP + TLS 握手，不登录、不发信，不碰密码。
LOG=/var/log/bt-smtp-check.log; FLAG=/var/lib/bt/smtp-down; mkdir -p /var/lib/bt
if timeout 15 openssl s_client -starttls smtp -connect smtp.qq.com:587 -brief </dev/null 2>&1 | grep -q "CONNECTION ESTABLISHED"; then
  echo "$(date -Is) ok" >> "$LOG"; rm -f "$FLAG"
else
  echo "$(date -Is) FAIL" >> "$LOG"; date -Is >> "$FLAG"
fi
