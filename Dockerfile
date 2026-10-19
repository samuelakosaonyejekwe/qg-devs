# QG-DEVS production image: API + web app + worker/scheduler in one image (process chosen by command).
# Stage 1 — web app (PWA)
FROM node:20-bookworm-slim AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY tools/ /src/tools/
RUN npm run build

# Stage 2 — native C++ kernel
FROM debian:bookworm-slim AS native
RUN apt-get update && apt-get install -y --no-install-recommends g++ make && rm -rf /var/lib/apt/lists/*
WORKDIR /src/cpp
COPY cpp/ ./
RUN make -j"$(nproc)" && make test

# Stage 3 — runtime
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 QGDEVS_HOME=/data QGDEVS_REQUIRE_TOKENS=1 \
    QGDEVS_NATIVE_LIB=/app/cpp/build/libqgdevs_native.so
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 --home /app qgdevs
WORKDIR /app
COPY pyproject.toml ./
COPY qgdevs/ ./qgdevs/
RUN pip install --no-cache-dir ".[llm,backup]"
COPY --from=native /src/cpp/build/libqgdevs_native.so ./cpp/build/libqgdevs_native.so
COPY --from=web /src/web/dist ./web/dist
COPY lean/proof_status.json ./lean/proof_status.json
COPY matlab/ ./matlab/
COPY deploy/start.sh /usr/local/bin/qgdevs-start
RUN chmod +x /usr/local/bin/qgdevs-start && mkdir -p /data && chown -R qgdevs /data
USER qgdevs
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=4)"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["qgdevs-start", "all"]
