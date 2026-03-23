#!/bin/bash
# =====================================================
# Setup script para Google Cloud VM (Ubuntu 22.04)
# Roda UMA VEZ na VM após criar a instância
# =====================================================

set -e

echo "=== [1/7] Atualizando sistema ==="
sudo apt-get update -y
sudo apt-get upgrade -y

echo "=== [2/7] Instalando dependências do sistema ==="
sudo apt-get install -y \
    curl git wget ca-certificates gnupg \
    nginx ufw \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
    libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 xdg-utils \
    ffmpeg \
    --no-install-recommends

echo "=== [3/7] Instalando Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "=== [4/7] Instalando Google Chrome ==="
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y /tmp/chrome.deb
rm /tmp/chrome.deb

echo "Chrome versão: $(google-chrome --version)"

echo "=== [5/7] Instalando PM2 ==="
sudo npm install -g pm2

echo "=== [6/7] Criando diretório da aplicação ==="
sudo mkdir -p /opt/whasapp
sudo chown $USER:$USER /opt/whasapp

echo "=== [7/7] Configurando firewall ==="
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp  # acesso direto temporário
sudo ufw --force enable

echo ""
echo "=== Configurando Nginx ==="
sudo tee /etc/nginx/sites-available/whasapp > /dev/null <<'NGINX'
server {
    listen 80;
    server_name _;

    # Aumenta limite de upload (imagens, áudios)
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/whasapp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
sudo systemctl enable nginx

echo ""
echo "=========================================="
echo "  Setup concluído!"
echo "  Próximo passo: rode ./deploy.sh na sua"
echo "  máquina local para enviar o código."
echo "=========================================="
