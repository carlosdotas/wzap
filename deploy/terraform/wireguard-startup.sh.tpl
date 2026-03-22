#!/bin/bash
set -e

echo "=== Iniciando configuração do WireGuard VPN ==="

# Atualiza pacotes
apt-get update -q
apt-get install -y wireguard iptables qrencode

# Habilita IP forwarding
echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-wireguard.conf
sysctl --system

# Gera chaves do servidor
cd /etc/wireguard
wg genkey | tee server_private.key | wg pubkey > server_public.key
chmod 600 server_private.key

SERVER_PRIVATE=$(cat server_private.key)
SERVER_PUBLIC=$(cat server_public.key)

# Gera chaves do primeiro cliente
wg genkey | tee client1_private.key | wg pubkey > client1_public.key
chmod 600 client1_private.key

CLIENT1_PRIVATE=$(cat client1_private.key)
CLIENT1_PUBLIC=$(cat client1_public.key)

# Descobre a interface de rede principal
IFACE=$(ip route get 1 | awk '{print $5; exit}')

# Cria configuração do servidor WireGuard
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.10.0.1/24
PrivateKey = $SERVER_PRIVATE
ListenPort = 51820
PostUp   = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o $IFACE -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o $IFACE -j MASQUERADE

# Cliente 1 (adicione mais abaixo para outros usuários)
[Peer]
PublicKey = $CLIENT1_PUBLIC
AllowedIPs = 10.10.0.2/32
EOF

chmod 600 /etc/wireguard/wg0.conf

# Cria configuração do cliente 1 (para copiar e usar no PC/celular)
cat > /etc/wireguard/client1.conf << EOF
[Interface]
PrivateKey = $CLIENT1_PRIVATE
Address = 10.10.0.2/24
DNS = 8.8.8.8

[Peer]
PublicKey = $SERVER_PUBLIC
Endpoint = ${vpn_server_ip}:51820
# Roteia só tráfego da VPC pelo túnel VPN
AllowedIPs = ${vpc_cidr}, 10.10.0.0/24
# Use 0.0.0.0/0 para rotear TODO o tráfego pelo VPN
# AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/client1.conf

# Habilita e inicia WireGuard
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

echo ""
echo "=== ✅ WireGuard configurado! ==="
echo ""
echo "📋 Para obter a configuração do cliente, execute:"
echo "   sudo cat /etc/wireguard/client1.conf"
echo ""
echo "📱 QR Code para celular (WireGuard app):"
qrencode -t ansiutf8 < /etc/wireguard/client1.conf

echo ""
echo "🔑 Chave pública do servidor: $SERVER_PUBLIC"
echo "🌐 IP do servidor: ${vpn_server_ip}:51820"
echo ""
echo "Para adicionar mais clientes VPN, veja: /etc/wireguard/README.txt"

# Cria guia de referência
cat > /etc/wireguard/README.txt << 'EOF'
=== Guia do Servidor WireGuard ===

Ver status da VPN:
  sudo wg show

Adicionar novo cliente:
  cd /etc/wireguard
  wg genkey | tee clientN_private.key | wg pubkey > clientN_public.key
  # Adicione no wg0.conf:
  # [Peer]
  # PublicKey = <clientN_public.key>
  # AllowedIPs = 10.10.0.N/32
  # Recarregue: wg syncconf wg0 <(wg-quick strip wg0)

Ver config do cliente 1:
  sudo cat /etc/wireguard/client1.conf

Reiniciar WireGuard:
  sudo systemctl restart wg-quick@wg0
EOF
