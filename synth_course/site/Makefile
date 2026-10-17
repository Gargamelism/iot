# One site (plus its notebooks' JupyterLab), run entirely in Docker. Needs
# `colima start` first.
#   make image   build the image          make dev     http://localhost:$(PORT) (+ Jupyter on $(JUPYTER_PORT))
#   make test    unit tests               make check   validate synth_course/ content
#   make build   production build         make sh      shell in the container
#   make nb-check  run every solution notebook headless
#   make e2e     headless-browser smoke test (needs `make dev` running)
#   make export / make import             back up / restore progress (data/export.json)
#   make npm ARGS="install foo"           run npm inside the container

IMAGE := synth-course-site
# 3000 is taken on this machine by an ssh tunnel
PORT  ?= 3100
JUPYTER_PORT ?= 8888
SITE  := $(abspath .)
# synth_course/: the content this site renders
COURSE := $(abspath ..)
DEV_CONTAINER := synth-course-dev

TTY := $(shell [ -t 0 ] && echo -t)
MOUNTS := \
	-v $(SITE):/app \
	-v $(COURSE):/course:ro \
	-v $(COURSE)/notebooks:/notebooks \
	-v synth-course-node-modules:/app/node_modules \
	-v synth-course-next:/app/.next \
	-v synth-course-data:/data
RUN := docker run --rm --init -i $(TTY) $(MOUNTS) $(IMAGE)

.PHONY: image deps dev test check build sh export import npm nb-check e2e

# Context is synth_course/ so the image can copy notebooks/requirements.txt
# (see ../.dockerignore — nothing else is sent).
image:
	docker build -t $(IMAGE) -f Dockerfile ..

deps: image
	$(RUN) npm install

dev: deps
	docker run --rm --init -i $(TTY) --name $(DEV_CONTAINER) \
		-p $(PORT):3000 -p $(JUPYTER_PORT):8888 \
		-e NEXT_PUBLIC_JUPYTER_URL=http://localhost:$(JUPYTER_PORT) \
		$(MOUNTS) $(IMAGE)

test: deps
	$(RUN) npm test

check: deps
	$(RUN) npm run check:content

build: deps
	$(RUN) npm run build

sh: image
	$(RUN) bash

export: deps
	$(RUN) npm run export

import: deps
	$(RUN) npm run import

npm: image
	$(RUN) npm $(ARGS)

nb-check: image
	$(RUN) sh -c 'cd /notebooks && for nb in solutions/*.ipynb; do \
		echo "== $$nb"; \
		jupyter nbconvert --to notebook --execute --stdout "$$nb" >/dev/null || exit 1; \
	done && echo "all solution notebooks ran"'

# Runs test/e2e.mjs in the Playwright image, sharing the dev container's
# network so it reaches the site on localhost:3000 and Jupyter on :8888.
e2e:
	docker run --rm --init --network container:$(DEV_CONTAINER) \
		-v $(SITE):/site:ro -v $(COURSE)/notebooks:/notebooks:ro -v synth-course-playwright:/pw -w /pw \
		mcr.microsoft.com/playwright:latest \
		sh -c '[ -d node_modules/playwright ] || (npm init -y >/dev/null && npm i -s playwright >/dev/null); \
		       npx playwright install chromium >/dev/null && cp /site/test/e2e.mjs . && node e2e.mjs'
