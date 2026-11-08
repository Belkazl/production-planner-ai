FROM postgres:18
RUN apt-get update && apt-get install -y --no-install-recommends python3-minimal \
    && rm -rf /var/lib/apt/lists/*
COPY migration_exporter/server.py /opt/migration_exporter/server.py
RUN chmod 0444 /opt/migration_exporter/server.py
USER postgres
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8080
EXPOSE 8080
CMD ["python3", "-u", "/opt/migration_exporter/server.py"]
