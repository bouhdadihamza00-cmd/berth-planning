FROM python:3.11-slim
WORKDIR /app
COPY requirements-lock.txt ./
RUN pip install --no-cache-dir -r requirements-lock.txt && useradd --create-home portside
COPY backend ./backend
COPY frontend ./frontend
COPY scripts/create_workspace.py scripts/backup_workspace.py scripts/start_trial.py ./scripts/
RUN mkdir -p /app/data && chown -R portside:portside /app
USER portside
ENV PORTOPS_DB=/app/data/portops.db
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
