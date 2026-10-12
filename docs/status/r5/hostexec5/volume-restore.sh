#!/bin/bash
# 还原测前音量：88、静音、输入 100（release1194/volume-before.txt 的读数）。
osascript -e 'set volume output volume 88' -e 'set volume input volume 100' -e 'set volume with output muted'
osascript -e 'get volume settings'
