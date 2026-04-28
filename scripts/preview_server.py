#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.server
import pathlib
import socketserver
import errno


class ReusableTCPServer(socketserver.TCPServer):
  allow_reuse_address = True


def build_handler(root: pathlib.Path, spa_fallback: bool) -> type[http.server.SimpleHTTPRequestHandler]:
  class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
      super().__init__(*args, directory=str(root), **kwargs)

    def send_head(self):
      if spa_fallback and self.path != "/":
        target = self.path.split("?", 1)[0].split("#", 1)[0]
        requested = root / target.lstrip("/")
        if not requested.exists():
          self.path = "/index.html"
      return super().send_head()

  return PreviewHandler


def resolve_default_root(repo_root: pathlib.Path) -> pathlib.Path:
  dist = repo_root / "frontend" / "dist"
  if dist.exists():
    return dist
  return repo_root / "frontend"


def parse_args() -> argparse.Namespace:
  repo_root = pathlib.Path(__file__).resolve().parents[1]
  parser = argparse.ArgumentParser(description="Serve frontend preview files.")
  parser.add_argument(
    "--host",
    default="127.0.0.1",
    help="Host interface to bind (default: 127.0.0.1)",
  )
  parser.add_argument(
    "--port",
    type=int,
    default=4173,
    help="Port to bind (default: 4173)",
  )
  parser.add_argument(
    "--dir",
    type=pathlib.Path,
    default=resolve_default_root(repo_root),
    help="Directory to serve (default: frontend/dist if present, else frontend)",
  )
  parser.add_argument(
    "--no-spa",
    action="store_true",
    help="Disable SPA fallback to /index.html",
  )
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  root = args.dir.resolve()

  if not root.exists() or not root.is_dir():
    raise SystemExit(f"Invalid directory: {root}")

  handler = build_handler(root, spa_fallback=not args.no_spa)

  try:
    server = ReusableTCPServer((args.host, args.port), handler)
  except OSError as exc:
    if exc.errno == errno.EADDRINUSE:
      raise SystemExit(
        f"Port {args.port} is already in use on {args.host}. "
        f"Try another one: python3 scripts/preview_server.py --port {args.port + 1}"
      ) from exc
    raise

  with server:
    url = f"http://{args.host}:{args.port}"
    print(f"Serving {root} at {url}")
    if not args.no_spa:
      print("SPA fallback enabled")
    try:
      server.serve_forever()
    except KeyboardInterrupt:
      print("\nServer stopped")


if __name__ == "__main__":
  main()
