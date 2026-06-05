FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies (curl is used by the HEALTHCHECK).
# NOTE: if you need linux/arm64 builds and jenkspy has no aarch64 wheel,
# add gcc and libc6-dev here so pip can compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
 && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (better caching)
# For local dev / CI, install requirements-dev.txt instead.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Create cache directory
RUN mkdir -p /app/cache

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV CACHE_DIR=/app/cache

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the app.
# WEB_CONCURRENCY defaults to 1 to stay within free-tier RAM limits (~512 MB).
# Override via environment variable on plans with more memory.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-1}"]
