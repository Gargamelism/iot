# Dev/test image for the course site. The source is bind-mounted at /app;
# node_modules, .next and the SQLite db live in named volumes (see Makefile).
FROM node:22-bookworm-slim

# better-sqlite3 builds natively if no prebuilt binary matches; sqlite3 is for
# poking at /data/course.db by hand (make sh).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ sqlite3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_POLL_MS=1000 \
    COURSE_DIR=/course \
    DB_PATH=/data/course.db \
    NPM_CONFIG_UPDATE_NOTIFIER=false
EXPOSE 3000
CMD ["npm", "run", "dev"]
