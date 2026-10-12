#!/bin/bash
# 临时取消静音（音量 60），测完必须跑 volume-restore.sh 还原 88 + 静音。
osascript -e 'set volume output volume 60' -e 'set volume without output muted'
osascript -e 'get volume settings'
