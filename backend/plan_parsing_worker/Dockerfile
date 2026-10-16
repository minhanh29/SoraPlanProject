FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host ${HOST} --port ${PORT}"]
