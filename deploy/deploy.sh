#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# WZAP - Script de Deploy para Google Cloud Run
# Uso: ./deploy/deploy.sh [PROJECT_ID] [REGION] [APP_NAME] [IMAGE_TAG]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuração ──────────────────────────────────────────────────────────────
PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
REGION="${2:-southamerica-east1}"
APP_NAME="${3:-wzap}"
IMAGE_TAG="${4:-latest}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "❌ Erro: PROJECT_ID não definido."
  echo "   Uso: ./deploy/deploy.sh <project-id> [region] [app-name] [image-tag]"
  echo "   Ou:  export GOOGLE_CLOUD_PROJECT=<project-id> && ./deploy/deploy.sh"
  exit 1
fi

REGISTRY="${REGION}-docker.pkg.dev"
IMAGE_URL="${REGISTRY}/${PROJECT_ID}/${APP_NAME}/${APP_NAME}:${IMAGE_TAG}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "╔══════════════════════════════════════════════════╗"
echo "║           WZAP - Deploy para Google Cloud        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Projeto  : ${PROJECT_ID}"
echo "  Região   : ${REGION}"
echo "  App      : ${APP_NAME}"
echo "  Imagem   : ${IMAGE_URL}"
echo ""

# ── Verifica pré-requisitos ──────────────────────────────────────────────────
check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌ '$1' não encontrado. Instale antes de continuar."
    exit 1
  fi
}

check_command gcloud
check_command docker

echo "🔍 Verificando autenticação no Google Cloud..."
if ! gcloud auth print-access-token &>/dev/null; then
  echo "🔑 Fazendo login no Google Cloud..."
  gcloud auth login
fi

gcloud config set project "${PROJECT_ID}"

# ── Configura Docker para o Artifact Registry ─────────────────────────────────
echo "🐳 Configurando Docker para o Artifact Registry..."
gcloud auth configure-docker "${REGISTRY}" --quiet

# ── Build da imagem Docker ────────────────────────────────────────────────────
echo ""
echo "🔨 Fazendo build da imagem Docker..."
cd "${PROJECT_ROOT}"
docker build \
  --platform linux/amd64 \
  --tag "${IMAGE_URL}" \
  --tag "${REGISTRY}/${PROJECT_ID}/${APP_NAME}/${APP_NAME}:$(git rev-parse --short HEAD 2>/dev/null || echo 'local')" \
  .

echo ""
echo "⬆️  Enviando imagem para o Artifact Registry..."
docker push "${IMAGE_URL}"

# ── Deploy no Cloud Run ───────────────────────────────────────────────────────
echo ""
echo "🚀 Fazendo deploy no Cloud Run..."
gcloud run deploy "${APP_NAME}" \
  --image "${IMAGE_URL}" \
  --region "${REGION}" \
  --platform managed \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 1 \
  --timeout 3600 \
  --concurrency 80 \
  --no-cpu-throttling \
  --set-env-vars NODE_ENV=production \
  --quiet

# ── Resultado ─────────────────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "${APP_NAME}" \
  --region "${REGION}" \
  --format 'value(status.url)')

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              ✅ Deploy concluído!                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  📡 URL do serviço : ${SERVICE_URL}"
echo "  🔍 Health check   : ${SERVICE_URL}/health"
echo "  📊 Monitor        : ${SERVICE_URL}/monitor.html"
echo ""
echo "  🔧 Logs em tempo real:"
echo "     gcloud run services logs tail ${APP_NAME} --region=${REGION}"
echo ""
echo "  🌐 Console Cloud Run:"
echo "     https://console.cloud.google.com/run/detail/${REGION}/${APP_NAME}/metrics?project=${PROJECT_ID}"
echo ""
