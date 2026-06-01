# Daimon — Hugging Face Docker Space (also runs on any Docker host)
FROM python:3.12-slim

# onnxruntime (chroma's default embeddings) needs libgomp at runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user (Hugging Face Spaces convention)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    DAIMON_RAG_BACKEND=chroma \
    DAIMON_DB=/home/user/daimon.db \
    PORT=7860

WORKDIR /app
COPY --chown=user:user . /app

# Install the package with the chroma (vector RAG) + turso (durable storage) extras
RUN pip install --no-cache-dir --user ".[vector,turso]"

# Bake the embedding model + prebuild the vector index so cold starts are fast.
# (Runs at build time; no API key needed — retrieval embeddings are local.)
RUN python -m daimon.rag.ingest || true

EXPOSE 7860
CMD ["sh", "-c", "uvicorn daimon.api:app --host 0.0.0.0 --port ${PORT:-7860}"]
