FROM python:3.12-slim
WORKDIR /srv
COPY ga_workers/ /srv/ga_workers/
ENV PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["python", "-m", "ga_workers.server"]
