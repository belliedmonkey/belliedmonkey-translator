// deploy/china/diagrecv/main.go — 诊断音频信箱（§0.4.1，2026-10-06 用户拍板）。
// 极简 write-only 接收器：POST /diag-audio?name=<install>/<file> → 落盘 /data/diag-audio/<install>/<file>。
// 纪律：无列目录、无下载（读靠 SSH）；单文件 25MB 上限；cron 72h 清理（compose 侧 crond 或宿主 cron）。
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

var safe = regexp.MustCompile(`^[A-Za-z0-9_.\-+/]+$`)
const root = "/data/diag-audio"
const maxSize = 25 << 20

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed); return
		}
		name := strings.TrimPrefix(r.URL.Query().Get("name"), "/")
		if !safe.MatchString(name) || strings.Contains(name, "..") || name == "" {
			w.WriteHeader(http.StatusBadRequest); fmt.Fprint(w, "bad name"); return
		}
		dst := filepath.Join(root, filepath.FromSlash(path.Clean("/"+name)))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			w.WriteHeader(500); return
		}
		f, err := os.Create(dst)
		if err != nil { w.WriteHeader(500); return }
		defer f.Close()
		n, err := io.Copy(f, io.LimitReader(r.Body, maxSize+1))
		if err != nil || n > maxSize {
			os.Remove(dst)
			w.WriteHeader(http.StatusRequestEntityTooLarge); return
		}
		w.WriteHeader(http.StatusCreated)
	})
	log.Fatal(http.ListenAndServe(":8100", nil))
}
