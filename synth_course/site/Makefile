# One site, run entirely in Docker (no local Node). Needs `colima start` first.
#   make image   build the image          make dev     http://localhost:$(PORT)
#   make test    unit tests               make check   validate synth_course/ content
#   make build   production build         make sh      shell in the container
#   make export / make import             back up / restore progress (data/export.json)
#   make npm ARGS="install foo"           run npm inside the container

IMAGE := synth-course-site
# 3000 is taken on this machine by an ssh tunnel
PORT  ?= 3100
SITE  := $(abspath .)
# synth_course/: the content this site renders
COURSE := $(abspath ..)

TTY := $(shell [ -t 0 ] && echo -t)
RUN := docker run --rm -i $(TTY) \
	-v $(SITE):/app \
	-v $(COURSE):/course:ro \
	-v synth-course-node-modules:/app/node_modules \
	-v synth-course-next:/app/.next \
	-v synth-course-data:/data \
	$(IMAGE)

.PHONY: image deps dev test check build sh export import npm

image:
	docker build -t $(IMAGE) .

deps: image
	$(RUN) npm install

dev: deps
	docker run --rm -i $(TTY) -p $(PORT):3000 \
		-v $(SITE):/app -v $(COURSE):/course:ro \
		-v synth-course-node-modules:/app/node_modules \
		-v synth-course-next:/app/.next \
		-v synth-course-data:/data \
		$(IMAGE) npm run dev -- --hostname 0.0.0.0

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
