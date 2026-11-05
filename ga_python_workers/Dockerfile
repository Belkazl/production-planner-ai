FROM python:3.12-slim
WORKDIR /srv
COPY ga_workers/ /srv/ga_workers/
COPY tests/ /srv/tests/
RUN python -m py_compile /srv/ga_workers/manager.py /srv/ga_workers/full_runtime_adapter.py && python -m unittest tests.test_process_isolation
ENV PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["python", "-m", "ga_workers.server"]
