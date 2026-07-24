#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: serve-git-smart-http.sh [--host HOST] [--port PORT] [--state-dir DIR] WORKTREE

Serve a Git worktree as a read-only Smart HTTP repository. The server supports
clone, fetch, and pull at its root URL. Push/receive-pack is always denied.

Options:
  --host HOST       Listen address (default: 127.0.0.1)
  --port PORT       Listen port (default: 3000)
  --state-dir DIR   Persistent mirror/runtime directory (default: temporary)
  -h, --help        Show this help
EOF
}

host=127.0.0.1
port=3000
state_dir=${GIT_SMART_HTTP_STATE_DIR:-}
while (($#)); do
  case "$1" in
    --host) host=${2:?missing --host value}; shift 2 ;;
    --port) port=${2:?missing --port value}; shift 2 ;;
    --state-dir) state_dir=${2:?missing --state-dir value}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) break ;;
  esac
done

if (($# != 1)); then usage >&2; exit 2; fi
if [[ $1 != /* ]]; then
  echo "WORKTREE must be an absolute path: $1" >&2
  exit 2
fi
worktree=$(realpath -e "$1")
if ! git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a Git worktree: $worktree" >&2
  exit 2
fi
if [[ ! $port =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then
  echo "Invalid port: $port" >&2
  exit 2
fi

cleanup_state=false
if [[ -z $state_dir ]]; then
  state_dir=$(mktemp -d -t oyster-git-http.XXXXXX)
  cleanup_state=true
else
  mkdir -p "$state_dir"
  state_dir=$(realpath "$state_dir")
fi
mirror="$state_dir/repository.git"
server_py="$state_dir/smart_http_server.py"

cleanup() {
  if $cleanup_state; then rm -rf "$state_dir"; fi
}
trap cleanup EXIT INT TERM

if [[ ! -d $mirror ]]; then
  git clone --quiet --mirror --no-local "$worktree" "$mirror"
fi
git -C "$mirror" config http.receivepack false
git -C "$mirror" config daemon.receivepack false

cat >"$server_py" <<'PY'
import argparse
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--host", required=True)
parser.add_argument("--port", required=True, type=int)
parser.add_argument("--worktree", required=True)
parser.add_argument("--mirror", required=True)
args = parser.parse_args()
project_root = os.path.dirname(args.mirror)
repository_name = os.path.basename(args.mirror)
sync_lock = threading.Lock()

def git(*arguments, cwd=None, check=True):
    return subprocess.run(
        ["git", *arguments], cwd=cwd, check=check,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )

def sync_mirror():
    with sync_lock:
        git("fetch", "--quiet", "--prune", args.worktree,
            "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*",
            cwd=args.mirror)
        symbolic = git("symbolic-ref", "-q", "HEAD", cwd=args.worktree, check=False)
        if symbolic.returncode == 0:
            git("symbolic-ref", "HEAD", symbolic.stdout.strip(), cwd=args.mirror)
        else:
            commit = git("rev-parse", "HEAD", cwd=args.worktree).stdout.strip()
            git("update-ref", "refs/heads/worktree-head", commit, cwd=args.mirror)
            git("symbolic-ref", "HEAD", "refs/heads/worktree-head", cwd=args.mirror)

class SmartGitHandler(BaseHTTPRequestHandler):
    server_version = "OysterGitSmartHTTP/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *values):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % values))

    def do_GET(self): self.serve_git()
    def do_HEAD(self): self.serve_git(head_only=True)
    def do_POST(self): self.serve_git()

    def serve_git(self, head_only=False):
        parsed = urlsplit(self.path)
        if parsed.path in {"", "/"} and "service=" not in parsed.query and self.command in {"GET", "HEAD"}:
            body = b"Oyster read-only Git Smart HTTP server\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if not head_only: self.wfile.write(body)
            return
        if "git-receive-pack" in parsed.path or "service=git-receive-pack" in parsed.query:
            self.send_error(403, "Push is disabled")
            return
        if self.command not in {"GET", "HEAD", "POST"}:
            self.send_error(405)
            return
        try:
            sync_mirror()
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or "cannot synchronize repository").strip()
            self.send_error(500, detail)
            return

        path = parsed.path if parsed.path.startswith("/") else "/" + parsed.path
        path_info = "/" + repository_name + (path if path != "/" else "/")
        environment = os.environ.copy()
        environment.update({
            "GIT_PROJECT_ROOT": project_root,
            "GIT_HTTP_EXPORT_ALL": "1",
            "PATH_INFO": path_info,
            "QUERY_STRING": parsed.query,
            "REQUEST_METHOD": self.command,
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": self.headers.get("Content-Length", ""),
            "REMOTE_ADDR": self.client_address[0],
            "SERVER_PROTOCOL": self.request_version,
            "SERVER_NAME": self.server.server_address[0],
            "SERVER_PORT": str(self.server.server_address[1]),
        })
        for name, value in self.headers.items():
            key = "HTTP_" + name.upper().replace("-", "_")
            if key not in {"HTTP_CONTENT_TYPE", "HTTP_CONTENT_LENGTH"}:
                environment[key] = value

        process = subprocess.Popen(
            ["git", "http-backend"], env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        length = int(self.headers.get("Content-Length", "0") or 0)
        remaining = length
        try:
            while remaining:
                chunk = self.rfile.read(min(remaining, 64 * 1024))
                if not chunk: break
                process.stdin.write(chunk)
                remaining -= len(chunk)
            process.stdin.close()

            status = 200
            headers = []
            while True:
                line = process.stdout.readline()
                if line in {b"", b"\n", b"\r\n"}: break
                name, value = line.decode("latin-1").rstrip("\r\n").split(":", 1)
                if name.lower() == "status": status = int(value.strip().split(" ", 1)[0])
                else: headers.append((name.strip(), value.strip()))
            self.send_response(status)
            for name, value in headers:
                if name.lower() not in {"connection", "transfer-encoding"}:
                    self.send_header(name, value)
            self.send_header("Connection", "close")
            self.end_headers()
            if not head_only:
                while True:
                    chunk = process.stdout.read(64 * 1024)
                    if not chunk: break
                    self.wfile.write(chunk)
            process.wait()
            if process.returncode:
                sys.stderr.write(process.stderr.read().decode("utf-8", "replace"))
        except (BrokenPipeError, ConnectionResetError):
            process.kill()
        finally:
            if process.poll() is None: process.wait()

sync_mirror()
server = ThreadingHTTPServer((args.host, args.port), SmartGitHandler)
print(f"Git Smart HTTP serving {args.worktree} at http://{args.host}:{args.port}/", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY

exec python3 "$server_py" --host "$host" --port "$port" --worktree "$worktree" --mirror "$mirror"
