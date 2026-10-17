# Dev/test image for the course site and its notebooks. The site source is
# bind-mounted at /app and the notebooks at /notebooks; node_modules, .next and
# the SQLite db live in named volumes (see Makefile). Python + JupyterLab live
# in /opt/venv, inside the image.
FROM node:22-bookworm-slim

# better-sqlite3 builds natively if no prebuilt binary matches; sqlite3 is for
# poking at /data/course.db by hand (make sh).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv make g++ sqlite3 \
 && rm -rf /var/lib/apt/lists/*

COPY notebooks/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_POLL_MS=1000 \
    COURSE_DIR=/course \
    DB_PATH=/data/course.db \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PYTHONPATH=/notebooks
EXPOSE 3000 8888
CMD ["./dev.sh"]
