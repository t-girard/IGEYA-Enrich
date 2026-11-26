# IGEYA Enrich : le site (Next.js, export statique) + l'API (FastAPI), dans une seule image.
# Railway détecte ce fichier et l'utilise automatiquement.

# ---- 1. Compilation du site
FROM node:22-slim AS site
WORKDIR /site
COPY source/package.json source/package-lock.json ./
RUN npm ci
COPY source/ ./
RUN npm run build

# ---- 2. API Python, qui sert aussi le site compilé
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 STATIC_DIR=/app/site
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=site /site/out /app/site
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
