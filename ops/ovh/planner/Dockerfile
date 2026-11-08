FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONUNBUFFERED=1
# Install the gateway's required PostgreSQL client at image-build time.
# The legacy launcher requests this package at startup; having it installed
# avoids package downloads while the isolated service boots with restricted capabilities.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client; \
    rm -rf /var/lib/apt/lists/*
COPY apt-get /usr/local/bin/apt-get
RUN chmod 0755 /usr/local/bin/apt-get
# The real gateway source is restored from protected Railway environment values at runtime.
