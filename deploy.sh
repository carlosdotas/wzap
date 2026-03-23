#!/bin/bash
# =====================================================
# Deploy script - roda na sua máquina LOCAL
# Envia o código para a VPS via rsync/scp
# =====================================================

set -e

# ===== CONFIGURE AQUI =====
VM_USER="seu-usuario"           # usuário SSH da VM (ex: ubuntu, seu nome google)
VM_IP="IP_DA_SUA_VM"            # IP externo da VM no GCP
SSH_KEY="~/.ssh/id_rsa"         # caminho da sua chave SSH (ou omita se usar default)
APP_DIR="/opt/whasapp"
# ===========================

echo "=== Enviando código para a VM $VM_IP ==="

rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.wwebjs_auth' \
    --exclude '.wwebjs_cache' \
    --exclude 'tmp' \
    --exclude '*.log' \
    --exclude '.env' \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
    ./ $VM_USER@$VM_IP:$APP_DIR/

echo "=== Instalando dependências na VM ==="
ssh -i $SSH_KEY $VM_USER@$VM_IP "cd $APP_DIR && npm ci --omit=dev"

echo "=== Criando diretório de dados ==="
ssh -i $SSH_KEY $VM_USER@$VM_IP "mkdir -p $APP_DIR/data $APP_DIR/logs"

echo "=== Reiniciando aplicação com PM2 ==="
ssh -i $SSH_KEY $VM_USER@$VM_IP "
    cd $APP_DIR && \
    pm2 stop whasapp 2>/dev/null || true && \
    pm2 start ecosystem.config.js && \
    pm2 save && \
    pm2 startup 2>/dev/null | tail -1 | bash 2>/dev/null || true
"

echo ""
echo "=========================================="
echo "  Deploy concluído!"
echo "  Acesse: http://$VM_IP"
echo "  Logs: ssh $VM_USER@$VM_IP 'pm2 logs whasapp'"
echo "  Status: ssh $VM_USER@$VM_IP 'pm2 status'"
echo "=========================================="
