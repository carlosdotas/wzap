# WhatsApp Bot Control

Painel web completo para automação do WhatsApp com API REST, webhook e interface administrativa.
Hospedado em **https://dotas.site**.

---

## Funcionalidades

- **Painel administrativo** protegido por login
- **Envio individual** de mensagens de texto
- **Envio em massa** com fila e delay configurável
- **Agendamento** de mensagens por data/hora
- **Status do WhatsApp** — postagem de texto e mídia (foto/vídeo)
- **API REST** documentada com Swagger UI
- **Webhook** — recebe mensagens e encaminha para URL externa (inclui mídia em base64)
- **Auto-reconexão** com delay de 10s em caso de queda
- **Limpeza de sessão** via painel (force re-scan do QR Code)

---

## Acesso

| URL | Descrição |
|-----|-----------|
| `https://dotas.site` | Painel administrativo |
| `https://dotas.site/api-docs` | Documentação Swagger + instruções para IA |
| `https://dotas.site/api/status` | Status da conexão (REST) |

---

## API REST

Todas as rotas exigem o header:
```
X-API-Key: sua-chave-aqui
```
A chave é gerada e exibida na aba **API & Webhook** do painel.

### Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/status` | Status da conexão WhatsApp |
| `POST` | `/api/send` | Enviar mensagem de texto |
| `POST` | `/api/send-media` | Enviar mídia (imagem, vídeo, documento) |
| `POST` | `/api/send-status` | Postar no Status do WhatsApp |
| `GET` | `/api/webhook` | Obter configuração do webhook |
| `POST` | `/api/webhook` | Configurar URL do webhook |
| `POST` | `/api/apikey/regenerate` | Gerar nova chave de API |
| `GET` | `/api/messages` | Histórico de mensagens recebidas |

### Exemplos

**Enviar texto:**
```json
POST /api/send
{
  "number": "5511999999999",
  "message": "Olá! Como posso ajudar?"
}
```

**Enviar mídia por URL:**
```json
POST /api/send-media
{
  "number": "5511999999999",
  "url": "https://exemplo.com/imagem.jpg",
  "mimetype": "image/jpeg",
  "caption": "Confira nossa promoção!"
}
```

**Enviar mídia por Base64:**
```json
POST /api/send-media
{
  "number": "5511999999999",
  "base64": "iVBORw0KGgo...",
  "mimetype": "image/png",
  "filename": "foto.png",
  "caption": "Legenda opcional"
}
```

**Postar no Status:**
```json
POST /api/send-status
{
  "message": "Bom dia! 🌅"
}
```

---

## Webhook

Configure a URL no painel (aba **API & Webhook**) ou via API:

```json
POST /api/webhook
{
  "url": "https://meuservidor.com/webhook",
  "secret": "token-de-validacao"
}
```

Quando uma mensagem é recebida, o bot faz `POST` na URL configurada com:

```json
{
  "event": "message_received",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "data": {
    "from": "5511999999999@c.us",
    "fromName": "Nome do Contato",
    "body": "texto da mensagem",
    "type": "chat",
    "hasMedia": false,
    "media": null
  }
}
```

Se a mensagem contiver mídia, o campo `media` será preenchido com:
```json
{
  "data": "base64...",
  "mimetype": "image/jpeg",
  "filename": "foto.jpg"
}
```

O header `X-Webhook-Secret` é enviado em todas as requisições para validação de origem.

---

## Infraestrutura

| Item | Detalhe |
|------|---------|
| Servidor | Google Cloud VM (`e2-medium`) — `southamerica-east1-c` |
| IP externo | `34.39.219.177` |
| Domínio | `dotas.site` + `www.dotas.site` (HTTPS via Let's Encrypt) |
| Certificado | Válido até 21/06/2026 — renovação automática (Certbot) |
| Processo | PM2 — `pm2 status` |
| Node.js | v20 |
| App dir | `/opt/whasapp` |
| Dados | `/opt/whasapp/data/db.json` |
| Logs | `/opt/whasapp/logs/` |
| Sessão WA | `/opt/whasapp/data/.wwebjs_auth` |

---

## Deploy

```bash
# Enviar arquivos para a VM
gcloud compute scp index.js whasapp-vm:/opt/whasapp/ --zone=southamerica-east1-c
gcloud compute scp public/index.html public/script.js public/style.css \
  whasapp-vm:/opt/whasapp/public/ --zone=southamerica-east1-c

# Reiniciar aplicação
gcloud compute ssh whasapp-vm --zone=southamerica-east1-c \
  --command="pm2 restart whasapp && pm2 status"
```

---

## Certificado SSL

Certificado Let's Encrypt para `dotas.site` e `www.dotas.site`.
Renovação automática via Certbot. Para renovar manualmente na VM:

```bash
sudo certbot renew
sudo systemctl reload nginx
```

---

## Stack

| Componente | Tecnologia |
|------------|-----------|
| Runtime | Node.js 20 |
| WhatsApp | whatsapp-web.js + Puppeteer |
| Servidor web | Express 5 + Socket.IO |
| Processo | PM2 |
| Proxy reverso | Nginx (HTTPS, redirect www → apex) |
| Banco de dados | JSON local (`db.json`) |
| Certificado SSL | Let's Encrypt / Certbot |

---

## Avisos

O uso da biblioteca `whatsapp-web.js` não é oficial. Use com responsabilidade e evite práticas de spam que possam violar os Termos de Serviço do WhatsApp.
