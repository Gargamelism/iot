#!/bin/sh
# Container entrypoint for `make dev`: JupyterLab in the background, the site in
# the foreground; stopping one stops both. JupyterLab has no token (it's only
# published on localhost) and may be embedded by any localhost page, i.e. the
# site's notebook panel whatever PORT it runs on.
set -e

jupyter lab \
  --ip=0.0.0.0 --port=8888 --no-browser --allow-root \
  --ServerApp.root_dir=/notebooks \
  --IdentityProvider.token= --ServerApp.password= \
  --ServerApp.tornado_settings="{\"headers\": {\"Content-Security-Policy\": \"frame-ancestors 'self' http://localhost:*\"}}" \
  --ServerApp.log_level=WARN &
JUPYTER_PID=$!
trap 'kill $JUPYTER_PID 2>/dev/null' EXIT INT TERM

npm run dev -- --hostname 0.0.0.0
