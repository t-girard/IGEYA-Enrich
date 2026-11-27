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

# --- Outils système ---------------------------------------------------------
# gnupg / curl / wget : pour ajouter le dépôt Google Chrome
# xvfb : écran virtuel (Chrome headless dans un conteneur sans GPU)
# Les paquets Chrome tirent leurs propres dépendances (libglib2.0, libx11…).
RUN apt-get update && apt-get install -y --no-install-recommends \
        gnupg curl wget ca-certificates xvfb \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
       | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
       https://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && ln -sf /usr/bin/google-chrome-stable /usr/bin/google-chrome \
    && apt-get purge -y gnupg curl wget && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# --- Python -----------------------------------------------------------------
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 STATIC_DIR=/app/site
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=site /site/out /app/site
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
