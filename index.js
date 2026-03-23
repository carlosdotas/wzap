const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { OpenAI } = require("openai");
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const crypto = require('crypto');

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Diretório temporário: usa DATA_DIR se definido (VPS), senão pasta local
const dataDir = process.env.DATA_DIR || __dirname;
const tmpDir = path.join(dataDir, 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}
const { loadDB, saveDB } = require('./persistence');

function normalizePhone(phone) {
    let cleaned = phone.replace(/\D/g, '');

    // Caso 1: Com prefixo 55 e 13 dígitos (55 + DDD + 9 + 8 dígitos)
    // Ex: 5562996157340 -> 556296157340 (remove o 9 que está na posição 4)
    if (cleaned.startsWith('55') && cleaned.length === 13) {
        cleaned = cleaned.substring(0, 4) + cleaned.substring(5);
    }
    // Caso 2: Sem prefixo 55 e 11 dígitos (DDD + 9 + 8 dígitos)
    // Ex: 62996157340 -> 6296157340 (remove o 9 que está na posição 2)
    else if (!cleaned.startsWith('55') && cleaned.length === 11) {
        cleaned = cleaned.substring(0, 2) + cleaned.substring(3);
    }

    // Garante que tenha o prefixo 55 ao final para números de 10 dígitos (DDD + 8)
    if (!cleaned.startsWith('55') && cleaned.length === 10) {
        cleaned = '55' + cleaned;
    }

    return cleaned;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    maxHttpBufferSize: 1e8 // 100 MB
});
const port = process.env.PORT || 3000;

// Middleware para Express (caso use POST futuramente)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Sessão do WhatsApp: usa DATA_DIR se definido (VPS persistente), senão pasta local
const authDataPath = process.env.DATA_DIR || undefined;

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "client-one",
        ...(authDataPath && { dataPath: authDataPath })
    }),
    // Carrega o WhatsApp Web de cache remoto (GitHub) para evitar bloqueios de IP do Cloud Run
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
    },
    authTimeoutMs: 0, // Sem timeout para autenticação (aguarda QR ser escaneado)
    puppeteer: {
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        pipe: true,           // Evita timeout do WS endpoint no Cloud Run
        timeout: 120000,      // 2min para o Chrome iniciar
        protocolTimeout: 300000, // 5min para chamadas CDP
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--no-zygote',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=VizDisplayCompositor',
        ],
    }
});

// Login credentials
const AUTH_USER = 'admin';
const AUTH_PASS = '821332';

// Auth middleware
function requireAuth(req, res, next) {
    const cookie = req.headers.cookie || '';
    const authenticated = cookie.split(';').some(c => c.trim() === 'auth=ok');
    if (authenticated) return next();
    res.redirect('/login');
}

// Login page
app.get('/login', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login - WhatsApp Control</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Outfit',sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-card{background:#1e293b;border-radius:1.5rem;padding:2.5rem;width:100%;max-width:380px;box-shadow:0 0 40px rgba(0,0,0,.4)}
h1{font-size:1.5rem;margin-bottom:.25rem}h1 span{color:#10b981}
p{color:#94a3b8;font-size:.875rem;margin-bottom:2rem}
label{display:block;font-size:.8rem;color:#94a3b8;margin-bottom:.4rem}
input{width:100%;background:#0f172a;border:1px solid #334155;border-radius:.75rem;padding:.85rem 1rem;color:#f8fafc;font-family:'Outfit',sans-serif;font-size:1rem;outline:none;margin-bottom:1.25rem}
input:focus{border-color:#10b981}
button{width:100%;background:#10b981;border:none;border-radius:.75rem;padding:.85rem;color:#fff;font-family:'Outfit',sans-serif;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s}
button:hover{background:#059669}
.error{color:#ef4444;font-size:.85rem;margin-bottom:1rem;display:none}
</style>
</head>
<body>
<div class="login-card">
  <h1>WhatsApp <span>Control</span></h1>
  <p>Faça login para acessar o painel.</p>
  <div class="error" id="err">Usuário ou senha incorretos.</div>
  <form method="POST" action="/login">
    <label>Usuário</label>
    <input type="text" name="username" placeholder="admin" autofocus>
    <label>Senha</label>
    <input type="password" name="password" placeholder="••••••">
    <button type="submit">Entrar</button>
  </form>
</div>
<script>
  const p = new URLSearchParams(location.search);
  if(p.get('err')) document.getElementById('err').style.display='block';
</script>
</body>
</html>`);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === AUTH_USER && password === AUTH_PASS) {
        res.setHeader('Set-Cookie', 'auth=ok; Path=/; HttpOnly; SameSite=Strict');
        res.redirect('/');
    } else {
        res.redirect('/login?err=1');
    }
});

app.get('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', 'auth=; Path=/; Max-Age=0');
    res.redirect('/login');
});

// Generate API key if not in DB
function ensureApiKey() {
    if (!db.apiKey) {
        db.apiKey = crypto.randomUUID();
        saveDB(db);
    }
}

// API key middleware
function requireApiKey(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || key !== db.apiKey) {
        return res.status(401).json({ error: 'API key inválida ou ausente. Use o header X-API-Key.' });
    }
    next();
}

// Webhook sender
async function sendWebhook(payload) {
    const webhookUrl = db.webhook?.url;
    if (!webhookUrl) return;
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (db.webhook?.secret) headers['X-Webhook-Secret'] = db.webhook.secret;
        await axios.post(webhookUrl, payload, { headers, timeout: 8000 });
        console.log('Webhook enviado:', payload.event);
    } catch (err) {
        console.error('Erro ao enviar webhook:', err.message);
        io.emit('log', `⚠️ Webhook falhou: ${err.message}`);
    }
}

// Swagger spec
const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'WhatsApp Bot API',
        version: '1.0.0',
        description: 'API REST para envio de mensagens e configuração de webhook via WhatsApp Web.\n\nObs: Use a **chave de API** gerada no painel administrativo no header `X-API-Key`.'
    },
    servers: [{ url: '/', description: 'Servidor atual' }],
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-API-Key',
                description: 'Chave gerada no painel /admin'
            }
        },
        schemas: {
            SendMessageRequest: {
                type: 'object',
                required: ['number', 'message'],
                properties: {
                    number: { type: 'string', example: '5511999999999', description: 'Número com DDI e DDD, sem +' },
                    message: { type: 'string', example: 'Olá! Como posso ajudar?', description: 'Texto da mensagem' }
                }
            },
            SendMediaRequest: {
                type: 'object',
                required: ['number', 'mimetype'],
                properties: {
                    number: { type: 'string', example: '5511999999999' },
                    url: { type: 'string', example: 'https://example.com/imagem.jpg', description: 'URL pública da mídia (use url OU base64)' },
                    base64: { type: 'string', description: 'Conteúdo da mídia em Base64 (sem prefixo data:...)' },
                    mimetype: { type: 'string', example: 'image/jpeg', description: 'MIME type da mídia' },
                    filename: { type: 'string', example: 'foto.jpg' },
                    caption: { type: 'string', example: 'Veja nossa promoção!' }
                }
            },
            WebhookConfig: {
                type: 'object',
                properties: {
                    url: { type: 'string', example: 'https://meuservidor.com/webhook', description: 'URL para receber eventos do WhatsApp' },
                    secret: { type: 'string', example: 'token-secreto', description: 'Enviado no header X-Webhook-Secret para validação' }
                }
            },
            SuccessResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    to: { type: 'string', example: '5511999999999@c.us' }
                }
            },
            StatusResponse: {
                type: 'object',
                properties: {
                    status: { type: 'string', example: 'Conectado' },
                    connected: { type: 'boolean', example: true }
                }
            },
            ErrorResponse: {
                type: 'object',
                properties: {
                    error: { type: 'string' }
                }
            }
        }
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
        '/api/status': {
            get: {
                tags: ['Sistema'],
                summary: 'Status da conexão WhatsApp',
                description: 'Retorna o status atual da conexão com o WhatsApp.',
                responses: {
                    200: { description: 'Status retornado', content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } } } },
                    401: { description: 'API key inválida', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
                }
            }
        },
        '/api/send': {
            post: {
                tags: ['Mensagens'],
                summary: 'Enviar mensagem de texto',
                description: 'Envia uma mensagem de texto para um número do WhatsApp.',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } } }
                },
                responses: {
                    200: { description: 'Mensagem enviada com sucesso', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
                    400: { description: 'Parâmetros inválidos' },
                    503: { description: 'WhatsApp não conectado' }
                }
            }
        },
        '/api/send-media': {
            post: {
                tags: ['Mensagens'],
                summary: 'Enviar mídia (imagem, vídeo, documento, áudio)',
                description: 'Envia um arquivo de mídia via URL pública ou Base64.',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMediaRequest' } } }
                },
                responses: {
                    200: { description: 'Mídia enviada com sucesso' },
                    400: { description: 'Parâmetros inválidos' },
                    503: { description: 'WhatsApp não conectado' }
                }
            }
        },
        '/api/webhook': {
            get: {
                tags: ['Webhook'],
                summary: 'Obter configuração do webhook',
                responses: {
                    200: { description: 'Configuração atual', content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookConfig' } } } }
                }
            },
            post: {
                tags: ['Webhook'],
                summary: 'Configurar URL do webhook',
                description: 'Define a URL para onde os eventos de mensagens recebidas serão enviados.',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookConfig' } } }
                },
                responses: {
                    200: { description: 'Webhook configurado com sucesso' }
                }
            }
        },
        '/api/send-status': {
            post: {
                tags: ['Mensagens'],
                summary: 'Postar no Status do WhatsApp',
                description: 'Posta um texto ou mídia (imagem/vídeo) no Status do WhatsApp (`status@broadcast`). Aceita texto simples, URL pública ou Base64.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string', example: 'Bom dia! 🌅', description: 'Texto do status (obrigatório se não enviar mídia)' },
                                    url: { type: 'string', example: 'https://example.com/imagem.jpg', description: 'URL pública da mídia (use url OU base64)' },
                                    base64: { type: 'string', description: 'Conteúdo da mídia em Base64' },
                                    mimetype: { type: 'string', example: 'image/jpeg', description: 'MIME type (obrigatório se enviar mídia)' },
                                    filename: { type: 'string', example: 'status.jpg' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Status postado com sucesso' },
                    400: { description: 'Parâmetros inválidos' },
                    503: { description: 'WhatsApp não conectado' }
                }
            }
        },
        '/api/apikey/regenerate': {
            post: {
                tags: ['Sistema'],
                summary: 'Gerar nova chave de API',
                description: 'Gera uma nova chave de API. A chave anterior será invalidada imediatamente.',
                responses: {
                    200: { description: 'Nova chave gerada', content: { 'application/json': { schema: { type: 'object', properties: { apiKey: { type: 'string' } } } } } }
                }
            }
        }
    }
};

// Swagger UI (via CDN)
app.get('/api-docs', requireAuth, (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <title>WhatsApp API - Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Outfit',sans-serif;background:#0f172a;color:#f8fafc}
    .topbar{display:none}
    /* Instructions section */
    .ai-instructions{max-width:1200px;margin:0 auto;padding:2rem 2rem 0}
    .ai-instructions h1{font-size:1.6rem;margin-bottom:.25rem}
    .ai-instructions h1 span{color:#10b981}
    .ai-instructions .subtitle{color:#94a3b8;font-size:.95rem;margin-bottom:1.5rem}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-bottom:1.5rem}
    .card{background:#1e293b;border-radius:1rem;padding:1.25rem}
    .card h3{font-size:.9rem;color:#10b981;margin-bottom:.75rem;text-transform:uppercase;letter-spacing:.05em}
    .card p,.card li{font-size:.85rem;color:#94a3b8;line-height:1.7}
    .card ul{padding-left:1.1rem}
    .card li{margin-bottom:.2rem}
    .card code,.inline-code{background:#0f172a;color:#10b981;padding:2px 7px;border-radius:4px;font-family:monospace;font-size:.8rem}
    .endpoint-list{display:flex;flex-direction:column;gap:.5rem}
    .endpoint{display:flex;align-items:center;gap:.6rem;font-size:.82rem}
    .method{font-weight:600;font-size:.72rem;padding:2px 7px;border-radius:4px;min-width:44px;text-align:center}
    .method.post{background:#0d3b2e;color:#10b981}
    .method.get{background:#1e3a5f;color:#60a5fa}
    .endpoint-path{color:#f8fafc;font-family:monospace}
    .endpoint-desc{color:#94a3b8}
    .code-example{background:#0f172a;border:1px solid #1e293b;border-radius:.75rem;padding:1rem;font-family:monospace;font-size:.78rem;color:#94a3b8;overflow-x:auto;white-space:pre;line-height:1.7}
    .code-example .hl{color:#10b981}
    .code-example .str{color:#f59e0b}
    .badge{display:inline-block;background:#0d3b2e;color:#10b981;border-radius:4px;padding:1px 8px;font-size:.75rem;margin-left:.4rem}
    .divider{border:none;border-top:1px solid #1e293b;margin:1.5rem 0}
    #swagger-ui{max-width:1200px;margin:0 auto;padding:0 1rem 2rem}
    .swagger-ui .info{display:none}
    .swagger-ui .scheme-container{background:#1e293b!important;padding:.75rem 1rem}
  </style>
</head>
<body>

<div class="ai-instructions">
  <h1>WhatsApp <span>Bot API</span> <span class="badge">v1.0</span></h1>
  <p class="subtitle">API REST para envio de mensagens, mídias e status via WhatsApp. Integre com agentes de IA, automações e sistemas externos.</p>

  <div class="cards">

    <div class="card">
      <h3>Autenticação</h3>
      <p>Todas as requisições devem incluir o header:</p>
      <p style="margin:.6rem 0"><code>X-API-Key: sua-chave-aqui</code></p>
      <p>A chave é gerada e exibida na aba <strong>API &amp; Webhook</strong> do painel administrativo em <code>/</code>.</p>
    </div>

    <div class="card">
      <h3>Endpoints disponíveis</h3>
      <div class="endpoint-list">
        <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/status</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/send</span><span class="endpoint-desc">— texto</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/send-media</span><span class="endpoint-desc">— imagem/vídeo/doc</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/send-status</span><span class="endpoint-desc">— status WhatsApp</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/webhook</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/webhook</span><span class="endpoint-desc">— configurar</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/messages</span><span class="endpoint-desc">— histórico</span></div>
      </div>
    </div>

    <div class="card">
      <h3>Enviar mensagem de texto</h3>
      <div class="code-example"><span class="hl">POST</span> /api/send
Content-Type: application/json
X-API-Key: <span class="str">sua-chave</span>

{
  <span class="hl">"number"</span>: <span class="str">"5511999999999"</span>,
  <span class="hl">"message"</span>: <span class="str">"Olá! Como posso ajudar?"</span>
}</div>
    </div>

    <div class="card">
      <h3>Enviar mídia por URL</h3>
      <div class="code-example"><span class="hl">POST</span> /api/send-media
X-API-Key: <span class="str">sua-chave</span>

{
  <span class="hl">"number"</span>: <span class="str">"5511999999999"</span>,
  <span class="hl">"url"</span>: <span class="str">"https://exemplo.com/img.jpg"</span>,
  <span class="hl">"mimetype"</span>: <span class="str">"image/jpeg"</span>,
  <span class="hl">"caption"</span>: <span class="str">"Confira nossa promoção!"</span>
}</div>
    </div>

    <div class="card">
      <h3>Postar no Status</h3>
      <div class="code-example"><span class="hl">POST</span> /api/send-status
X-API-Key: <span class="str">sua-chave</span>

<span class="hl">// Texto simples</span>
{ <span class="hl">"message"</span>: <span class="str">"Bom dia! 🌅"</span> }

<span class="hl">// Imagem com legenda</span>
{
  <span class="hl">"url"</span>: <span class="str">"https://exemplo.com/img.jpg"</span>,
  <span class="hl">"mimetype"</span>: <span class="str">"image/jpeg"</span>,
  <span class="hl">"message"</span>: <span class="str">"Confira!"</span>
}</div>
    </div>

    <div class="card">
      <h3>Webhook — payload recebido</h3>
      <p style="margin-bottom:.6rem">Configure a URL no painel. Ao receber mensagem, o bot faz <code>POST</code> com:</p>
      <div class="code-example">{
  <span class="hl">"event"</span>: <span class="str">"message_received"</span>,
  <span class="hl">"timestamp"</span>: <span class="str">"2024-01-01T12:00:00Z"</span>,
  <span class="hl">"data"</span>: {
    <span class="hl">"from"</span>: <span class="str">"5511999999999@c.us"</span>,
    <span class="hl">"fromName"</span>: <span class="str">"Nome"</span>,
    <span class="hl">"body"</span>: <span class="str">"texto"</span>,
    <span class="hl">"type"</span>: <span class="str">"chat"</span>,
    <span class="hl">"hasMedia"</span>: false,
    <span class="hl">"media"</span>: null
  }
}</div>
    </div>

    <div class="card">
      <h3>Instruções para agentes de IA</h3>
      <ul>
        <li>Use <code>GET /api/status</code> antes de enviar para verificar conexão</li>
        <li>Números devem incluir DDI+DDD sem <code>+</code> (ex: <code>5511999999999</code>)</li>
        <li>Mídias podem ser enviadas por <code>url</code> (preferido) ou <code>base64</code></li>
        <li>O header <code>X-Webhook-Secret</code> permite validar origem do evento</li>
        <li>Respostas de erro retornam <code>{"error": "mensagem"}</code></li>
        <li>Status HTTP: <code>200</code> sucesso · <code>400</code> params · <code>401</code> auth · <code>503</code> desconectado</li>
      </ul>
    </div>

  </div>
  <hr class="divider">
  <p style="color:#475569;font-size:.8rem;margin-bottom:1rem">Referência completa dos endpoints abaixo — clique em um endpoint para expandir e testar.</p>
</div>

<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    spec: ${JSON.stringify(swaggerSpec)},
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true
  });
</script>
</body>
</html>`);
});

// REST API routes (antes do requireAuth para não ser interceptado pelo redirect de login)
app.get('/api/status', requireApiKey, (req, res) => {
    res.json({ status: whatsappStatus, connected: whatsappStatus === 'Conectado' });
});

app.post('/api/send', requireApiKey, async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'number e message são obrigatórios' });
    if (whatsappStatus !== 'Conectado') return res.status(503).json({ error: 'WhatsApp não conectado', status: whatsappStatus });
    try {
        const chatId = number.includes('@') ? number : `${normalizePhone(number)}@c.us`;
        await client.sendMessage(chatId, message);
        io.emit('log', `📤 API: mensagem enviada para ${number}`);
        db.logs.sent.push({ to: chatId, message, type: 'api', timestamp: new Date().toISOString() });
        saveDB(db);
        res.json({ success: true, to: chatId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/send-media', requireApiKey, async (req, res) => {
    const { number, url, base64, mimetype, filename, caption } = req.body;
    if (!number || (!url && !base64) || !mimetype) {
        return res.status(400).json({ error: 'number, mimetype e (url ou base64) são obrigatórios' });
    }
    if (whatsappStatus !== 'Conectado') return res.status(503).json({ error: 'WhatsApp não conectado' });
    try {
        const chatId = number.includes('@') ? number : `${normalizePhone(number)}@c.us`;
        let media;
        if (url) {
            media = await MessageMedia.fromUrl(url, { unsafeMime: true });
        } else {
            media = new MessageMedia(mimetype, base64, filename || 'media');
        }
        await client.sendMessage(chatId, media, { caption: caption || '' });
        io.emit('log', `📤 API: mídia (${mimetype}) enviada para ${number}`);
        db.logs.sent.push({ to: chatId, message: caption || `[mídia: ${mimetype}]`, type: 'api_media', timestamp: new Date().toISOString() });
        saveDB(db);
        res.json({ success: true, to: chatId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/send-status', requireApiKey, async (req, res) => {
    const { message, url, base64, mimetype, filename } = req.body;
    if (!message && !url && !base64) {
        return res.status(400).json({ error: 'Forneça message (texto) ou mídia (url ou base64 + mimetype)' });
    }
    if (whatsappStatus !== 'Conectado') return res.status(503).json({ error: 'WhatsApp não conectado' });
    try {
        if (url || base64) {
            if (!mimetype) return res.status(400).json({ error: 'mimetype é obrigatório para mídia' });
            let media;
            if (url) {
                media = await MessageMedia.fromUrl(url, { unsafeMime: true });
            } else {
                const b64 = base64.includes(',') ? base64.split(',')[1] : base64;
                media = new MessageMedia(mimetype, b64, filename || 'status-media');
            }
            await client.sendMessage('status@broadcast', media, { caption: message || '' });
        } else {
            await client.sendMessage('status@broadcast', message);
        }
        io.emit('log', `📢 API: status postado`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/webhook', requireApiKey, (req, res) => {
    res.json({ url: db.webhook?.url || '', secret: db.webhook?.secret ? '***' : '' });
});

app.post('/api/webhook', requireApiKey, (req, res) => {
    const { url, secret } = req.body;
    db.webhook = { url: url || '', secret: secret || '' };
    saveDB(db);
    io.emit('webhook-config', { url: db.webhook.url, hasSecret: !!db.webhook.secret });
    io.emit('log', `🔗 Webhook configurado: ${url}`);
    res.json({ success: true });
});

app.post('/api/apikey/regenerate', requireApiKey, (req, res) => {
    db.apiKey = crypto.randomUUID();
    saveDB(db);
    io.emit('api-key', db.apiKey);
    res.json({ apiKey: db.apiKey });
});

app.get('/api/messages', requireApiKey, (_req, res) => {
    const received = (db.logs && db.logs.received) ? db.logs.received : [];
    res.json(received.slice(-200).reverse());
});

// Arquivos estáticos (protegidos por sessão)
app.use(requireAuth, express.static(path.join(__dirname, 'public')));

// Health check para Cloud Run
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', whatsapp: whatsappStatus });
});

// Inicializa Banco de Dados Local
let db = loadDB();
// Garante que existe API key
if (!db.apiKey) {
    db.apiKey = crypto.randomUUID();
    if (!db.webhook) db.webhook = { url: '', secret: '' };
    saveDB(db);
}

// Estado do sistema (Sincronizado com DB Local)
let whatsappStatus = 'Iniciando...';
let qrCodeImage = null;
let messageQueue = [];
let isProcessingQueue = false;

let scheduledMessages = db.scheduledMessages || [];
let aiSettings = db.aiSettings || { active: false, prompt: '', apiKey: '' };
let chatHistory = db.chatHistory || {}; // Memória das conversas
let clientesList = [];

// Inicializa lista de clientes
syncClientesList();

function syncClientesList() {
    // Usa apenas dados locais do db.users
    const allIds = Object.keys(db.users);

    clientesList = allIds.map(id => {
        const lUser = db.users[id] || {};
        return {
            id: id,
            nome: lUser.nome || 'Usuário Local',
            telefone: lUser.telefone || '',
            aiEnabled: lUser.aiEnabled || false
        };
    }).filter(u => u.telefone);

    io.emit('clientes-list', clientesList);
}

async function getAIResponse(userId, userMessage, isAudio = false, externalHistory = null) {
    if (!aiSettings.apiKey || !aiSettings.active) {
        console.log("⚠️ IA ignorada: Chave ausente ou Inativa.");
        return null;
    }

    const aiModel = aiSettings.model || "gemini-1.5-flash";
    let textResponse = "";

    // Usa o histórico externo (WhatsApp) se fornecido, senão usa o local
    let userHistory = [];
    if (externalHistory && Array.isArray(externalHistory)) {
        userHistory = externalHistory;
    } else {
        if (!chatHistory[userId]) chatHistory[userId] = [];
        userHistory = chatHistory[userId].slice(-10);
    }


    // Se for modelo da OpenAI
    if (aiModel.startsWith('gpt-')) {
        try {
            const openai = new OpenAI({ apiKey: aiSettings.apiKey });
            const messages = [
                { role: "system", content: aiSettings.prompt || "Você é um assistente virtual prestativo." },
                ...userHistory,
                { role: "user", content: userMessage }
            ];

            const response = await openai.chat.completions.create({
                model: aiModel,
                messages: messages,
                max_tokens: 500
            });
            textResponse = response.choices[0].message.content;
        } catch (error) {
            console.error("❌ ERRO NO OPENAI:", error.message);
            textResponse = `[Erro OpenAI: ${error.message}]`;
        }
    }
    // Senão, assume que é Gemini
    else {
        try {
            const genAI = new GoogleGenerativeAI(aiSettings.apiKey);
            const model = genAI.getGenerativeModel({ model: aiModel });

            // Converte histórico para formato Gemini
            const geminiHistory = userHistory.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));

            const chat = model.startChat({
                history: geminiHistory,
                generationConfig: { maxOutputTokens: 500 },
            });

            const systemPrompt = aiSettings.prompt ? `Instrução do Sistema: ${aiSettings.prompt}\n\n` : "";
            const result = await chat.sendMessage(`${systemPrompt}${userMessage}`);
            const response = await result.response;

            if (response.promptFeedback && response.promptFeedback.blockReason) {
                textResponse = `[IA Bloqueada: ${response.promptFeedback.blockReason}]`;
            } else {
                textResponse = response.text();
            }
        } catch (error) {
            console.error("❌ ERRO NO GEMINI:", error.message);
            textResponse = `[Erro Gemini: ${error.message}]`;
        }
    }

    // Salva no histórico se não houve erro crítico
    if (!textResponse.startsWith('[Erro')) {
        chatHistory[userId].push({ role: "user", content: userMessage });
        chatHistory[userId].push({ role: "assistant", content: textResponse });

        // Limita tamanho total do histórico no banco para não crescer infinito
        if (chatHistory[userId].length > 20) {
            chatHistory[userId] = chatHistory[userId].slice(-20);
        }

        db.chatHistory = chatHistory;
        saveDB(db);
    }

    // Se a mensagem original foi áudio, converte a resposta em áudio também
    if (isAudio && !textResponse.startsWith('[Erro')) {
        console.log("🎙️ Convertendo resposta em áudio...");
        const audioMedia = await textToSpeech(textResponse, aiSettings.apiKey);
        return { text: textResponse, audio: audioMedia };
    }

    return { text: textResponse };
}

async function transcribeAudio(media, apiKey) {
    const aiModel = aiSettings.model || "gemini-1.5-flash";

    // 1. Se usar OpenAI (sk-...), Whisper é a melhor escolha para o "Ouvido"
    if (apiKey && apiKey.startsWith('sk-')) {
        const tempPath = path.join(tmpDir, `audio_${Date.now()}.ogg`);
        const mp3Path = path.join(tmpDir, `audio_${Date.now()}.mp3`);

        try {
            console.log(`👂 Usando Whisper. Caminhos: \n- OGG: ${tempPath}\n- MP3: ${mp3Path}`);
            io.emit('log', "👂 Preparando áudio para transcrição...");

            fs.writeFileSync(tempPath, Buffer.from(media.data, 'base64'));

            if (!fs.existsSync(tempPath)) {
                throw new Error("Falha crítica: Arquivo OGG não foi gravado no disco.");
            }

            await runFfmpeg(['-i', tempPath, '-y', mp3Path]);
            console.log("✅ FFMPEG: Conversão MP3 concluída.");

            if (!fs.existsSync(mp3Path)) {
                throw new Error("Falha crítica: FFMPEG terminou mas o arquivo MP3 não existe.");
            }

            const openai = new OpenAI({ apiKey: apiKey });
            const transcription = await openai.audio.transcriptions.create({
                file: fs.createReadStream(mp3Path),
                model: "whisper-1",
            });

            // Limpeza segura
            const safeDelete = (p) => { if (fs.existsSync(p)) fs.unlinkSync(p); };
            safeDelete(tempPath);
            safeDelete(mp3Path);

            console.log("📝 Transcrição concluída com sucesso.");
            return transcription.text;
        } catch (err) {
            console.error("❌ Erro Whisper profundo:", err.message);
            io.emit('log', `⚠️ Erro no processamento: ${err.message}`);

            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
            return null;
        }
    }

    // 2. Se usar Gemini (ou como fallback), Gemini 1.5 Flash transcreve direto
    if (!aiModel.startsWith('gpt-')) {
        try {
            console.log("💎 Usando Gemini 1.5 Flash (Ouvido) para transcrição...");
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const result = await model.generateContent([
                {
                    inlineData: {
                        data: media.data,
                        mimeType: media.mimetype
                    }
                },
                "Transcreva este áudio exatamente. Retorne apenas o texto."
            ]);
            return result.response.text();
        } catch (err) {
            console.error("❌ Erro Gemini transcrição:", err.message);
        }
    }

    return null;
}

async function textToSpeech(text, apiKey) {
    const mp3Path = path.join(tmpDir, `tts_${Date.now()}.mp3`);
    const oggPath = path.join(tmpDir, `tts_${Date.now()}.ogg`);

    try {
        const openai = new OpenAI({ apiKey: apiKey });
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: aiSettings.voice || "alloy",
            input: text,
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        fs.writeFileSync(mp3Path, buffer);

        // Converte MP3 para OGG/Opus (formato padrão do WhatsApp Voice Notes)
        await runFfmpeg(['-i', mp3Path, '-c:a', 'libopus', '-y', oggPath]);

        const oggBuffer = fs.readFileSync(oggPath);
        const media = new MessageMedia('audio/ogg', oggBuffer.toString('base64'), 'response.ogg');

        // Limpeza
        if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
        if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);

        return media;
    } catch (err) {
        console.error("❌ Erro no TTS:", err.message);
        if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
        if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
        return null;
    }
}

// O Agendamento agora é gerenciado localmente, sem necessidade de listener do Firebase

// Verificador de agendamentos (roda a cada minuto)
cron.schedule('* * * * *', async () => {
    const now = new Date();
    let changed = false;

    for (const item of scheduledMessages) {
        if (new Date(item.datetime) <= now && !item.sent) {
            try {
                const number = item.number.includes('@c.us') ? item.number : `${item.number}@c.us`;
                await client.sendMessage(number, item.message);

                item.sent = true;
                item.sentAt = new Date().toISOString();
                changed = true;

                io.emit('log', `🕒 Agendado: Mensagem enviada para ${item.number}`);
            } catch (error) {
                io.emit('log', `🕒 Erro no agendado (${item.number}): ${error.message}`);
                item.error = error.message;
                changed = true;
            }
        }
    }

    if (changed) {
        db.scheduledMessages = scheduledMessages;
        saveDB(db);
        io.emit('scheduled-list', scheduledMessages);
    }
});

// Função para buscar tendências (simulação de temas baseados nos temas do usuário)
async function getTrendsAndGenerateContent() {
    const config = db.autoStatus;
    if (!config || !config.active) return;

    // Verifica horário
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = config.startTime.split(':').map(Number);
    const [endH, endM] = config.endTime.split(':').map(Number);
    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    if (currentTime < startTime || currentTime > endTime) {
        console.log("🕒 Fora do horário de postagem automática.");
        return;
    }

    console.log("🚀 Iniciando geração de Status Automático...");
    try {
        const themes = config.themes.split(',').map(t => t.trim());
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];

        // Simula busca por notícias/trends sobre o tema
        // Em um cenário real, poderíamos usar NEWS API ou similar
        const searchContext = `Assunto do momento: ${randomTheme}. Gere algo relevante e engajador.`;

        const aiResponse = await getAIResponse('status_auto', `${config.prompt}\n\nContexto: ${searchContext}`);
        if (!aiResponse || !aiResponse.text) return;

        let postContent = aiResponse.text;
        let media = null;

        if (config.type === 'image') {
            console.log("🎨 Gerando imagem para o status...");
            // Se tiver DALL-E/OpenAI configurado, poderíamos gerar imagem
            // Por enquanto, faremos o post apenas com legenda ou texto dependendo do modelo
        }

        // Publica no Status
        await client.sendMessage('status@broadcast', postContent);

        // Log do Post
        const newLog = {
            id: Date.now(),
            content: postContent,
            type: config.type,
            timestamp: new Date().toISOString()
        };

        db.autoStatus.logs = db.autoStatus.logs || [];
        db.autoStatus.logs.push(newLog);
        if (db.autoStatus.logs.length > 50) db.autoStatus.logs.shift();

        saveDB(db);
        io.emit('auto-status-logs', db.autoStatus.logs);
        io.emit('log', `✅ Status Automático postado sobre: ${randomTheme}`);

    } catch (err) {
        console.error("❌ Erro no Auto Status:", err.message);
        io.emit('log', `⚠️ Erro no Auto Status: ${err.message}`);
    }
}

// Agendador do Status Automático (roda a cada X minutos baseados no intervalo)
let autoStatusTimer = null;
function startAutoStatusInterval() {
    if (autoStatusTimer) clearInterval(autoStatusTimer);

    if (db.autoStatus && db.autoStatus.active) {
        const intervalMs = Math.max(db.autoStatus.interval, 15) * 60 * 1000;
        console.log(`⏱️ Automação de Status iniciada. Intervalo: ${db.autoStatus.interval} min.`);

        autoStatusTimer = setInterval(() => {
            getTrendsAndGenerateContent();
        }, intervalMs);

        // Executa um agora se não houver logs recentes
        if (!db.autoStatus.logs || db.autoStatus.logs.length === 0) {
            getTrendsAndGenerateContent();
        }
    }
}

// Inicia no boot
startAutoStatusInterval();

// Função para processar a fila com atraso de segurança
async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) return;

    isProcessingQueue = true;
    console.log('Iniciando processamento da fila...');

    while (messageQueue.length > 0) {
        const item = messageQueue[0];
        const delay = item.delay || 5000;

        io.emit('queue-status', {
            remaining: messageQueue.length,
            next: item.number,
            nextDelay: delay / 1000
        });

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            const number = item.number.includes('@c.us') ? item.number : `${item.number}@c.us`;
            await client.sendMessage(number, item.message);
            io.emit('log', `✓ Enviada para ${item.number}`);
            console.log(`Mensagem enviada para ${item.number}`);
        } catch (error) {
            io.emit('log', `✗ Erro ao enviar para ${item.number}: ${error.message}`);
            console.error(`Erro ao enviar para ${item.number}:`, error);
        }

        messageQueue.shift();
        io.emit('queue-status', { remaining: messageQueue.length });
    }

    isProcessingQueue = false;
    io.emit('log', 'Fila de envio finalizada.');
}

// Socket.io eventos
io.on('connection', (socket) => {
    console.log('Novo cliente conectado à interface');

    // Envia estado atual para o novo cliente
    socket.emit('status', whatsappStatus);
    socket.emit('queue-status', { remaining: messageQueue.length });
    socket.emit('scheduled-list', scheduledMessages);
    socket.emit('clientes-list', clientesList);
    socket.emit('ai-settings', aiSettings); // Adicionado para carregar IA ao abrir
    socket.emit('auto-status-settings', db.autoStatus || {});
    socket.emit('auto-status-logs', db.autoStatus?.logs || []);

    if (qrCodeImage) socket.emit('qr', qrCodeImage);

    socket.on('save-auto-status', (data) => {
        db.autoStatus = {
            ...db.autoStatus,
            ...data,
            logs: db.autoStatus?.logs || []
        };
        saveDB(db);
        socket.emit('auto-status-settings', db.autoStatus);
        socket.emit('log', `⚙️ Automação de Status atualizada: ${db.autoStatus.active ? 'ATIVADA' : 'DESATIVADA'}`);
    });

    socket.on('schedule-message', async (data) => {
        const { number, message, datetime } = data;
        const newItem = {
            id: Date.now().toString(),
            number,
            message,
            datetime,
            sent: false,
            createdAt: new Date().toISOString()
        };
        scheduledMessages.push(newItem);
        db.scheduledMessages = scheduledMessages;
        saveDB(db);

        io.emit('log', `📅 Novo agendamento salvo localmente para ${number}`);
        io.emit('scheduled-list', scheduledMessages);
    });

    socket.on('send-message', async (data) => {
        try {
            const number = data.number.includes('@c.us') ? data.number : `${data.number}@c.us`;
            await client.sendMessage(number, data.message);
            socket.emit('log', `Mensagem enviada para ${data.number}`);

            // Log Local
            db.logs.sent.push({
                to: data.number,
                message: data.message,
                timestamp: new Date().toISOString()
            });
            saveDB(db);
        } catch (error) {
            socket.emit('log', `Erro ao enviar: ${error.message}`);
        }
    });

    socket.on('send-bulk', (data) => {
        const { numbers, message, delay } = data;

        const newItems = numbers.map(num => ({
            number: num.trim(),
            message: message,
            delay: delay * 1000 // converte segundos para ms
        }));

        messageQueue.push(...newItems);
        io.emit('log', `${newItems.length} mensagens adicionadas à fila.`);
        processQueue();
    });

    socket.on('send-status', async (data) => {
        try {
            console.log(`Tentando enviar status. Mídia presente: ${!!data.media}`);

            if (data.media) {
                // Remove o prefixo base64 se existir (ex: data:image/png;base64,)
                const base64Data = data.media.includes(',') ? data.media.split(',')[1] : data.media;
                const mediaSize = Math.round((base64Data.length * 3) / 4) / 1024;
                console.log(`Tamanho da mídia: ${mediaSize.toFixed(2)} KB`);

                const media = new MessageMedia(data.mimetype, base64Data, data.filename || 'status-media');

                await client.sendMessage('status@broadcast', media, {
                    caption: data.message || ''
                });
                console.log('Status com mídia enviado com sucesso');
            } else {
                await client.sendMessage('status@broadcast', data.message);
                console.log('Status de texto enviado com sucesso');
            }
            socket.emit('log', '✓ Status enviado com sucesso!');
        } catch (error) {
            console.error('Erro ao enviar status:', error);
            socket.emit('log', `✗ Erro ao atualizar status: ${error.message}`);
        }
    });

    // Rota para resetar conexão se necessário
    socket.on('save-ai-settings', async (data) => {
        aiSettings = {
            apiKey: data.apiKey,
            prompt: data.prompt,
            model: data.model || "gemini-1.5-flash",
            active: data.active === 'true',
            replyAll: data.replyAll === 'true',
            voice: data.voice || "alloy"
        };
        db.aiSettings = aiSettings;
        saveDB(db);
        io.emit('ai-settings', aiSettings);
        io.emit('log', `⚙️ Agente ${aiSettings.model} configurado com voz ${aiSettings.voice}.`);
    });

    socket.on('toggle-ai-client', async (data) => {
        const { id, enabled } = data;
        const clienteRecord = clientesList.find(c => c.id === id);

        db.users[id] = {
            ...db.users[id],
            aiEnabled: enabled,
            nome: clienteRecord ? clienteRecord.nome : (db.users[id]?.nome || 'Usuário Local'),
            telefone: clienteRecord ? clienteRecord.telefone : (db.users[id]?.telefone || '')
        };
        saveDB(db);
        syncClientesList();
        io.emit('log', `🤖 IA ${enabled ? 'habilitada' : 'desabilitada'} para o cliente ID: ${id}`);
    });

    socket.on('toggle-ai-bulk', async (data) => {
        const { ids, enabled } = data;
        ids.forEach(id => {
            const clienteRecord = clientesList.find(c => c.id === id);
            db.users[id] = {
                ...db.users[id],
                aiEnabled: enabled,
                nome: clienteRecord ? clienteRecord.nome : (db.users[id]?.nome || 'Usuário Local'),
                telefone: clienteRecord ? clienteRecord.telefone : (db.users[id]?.telefone || '')
            };
        });
        saveDB(db);
        syncClientesList();
        io.emit('log', `🤖 IA ${enabled ? 'habilitada' : 'desabilitada'} em massa para ${ids.length} contatos.`);
    });

    socket.on('reset-connection', async () => {
        console.log('Reiniciando conexão...');
        whatsappStatus = 'Reiniciando...';
        io.emit('status', whatsappStatus);
        try {
            await client.destroy();
            client.initialize();
        } catch (e) {
            console.error('Erro ao reiniciar:', e);
        }
    });

    socket.on('clear-session', async () => {
        console.log('Limpando sessão...');
        whatsappStatus = 'Limpando sessão...';
        io.emit('status', whatsappStatus);
        io.emit('log', '🗑️ Limpando sessão do WhatsApp...');
        try {
            await client.destroy();
        } catch (e) {
            console.error('Erro ao destruir cliente:', e);
        }
        // Remove a pasta da sessão salva pelo LocalAuth
        const sessionPath = path.join(authDataPath || __dirname, '.wwebjs_auth');
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('Pasta de sessão removida:', sessionPath);
        }
        io.emit('log', '✅ Sessão apagada. Reiniciando para gerar novo QR Code...');
        whatsappStatus = 'Sessão limpa, reiniciando...';
        io.emit('status', whatsappStatus);
        setTimeout(() => {
            client.initialize();
        }, 2000);
    });

    socket.on('get-api-config', () => {
        socket.emit('api-key', db.apiKey);
        socket.emit('webhook-config', { url: db.webhook?.url || '', hasSecret: !!(db.webhook?.secret) });
    });

    socket.on('save-webhook', (data) => {
        db.webhook = { url: data.url || '', secret: data.secret || '' };
        saveDB(db);
        io.emit('webhook-config', { url: db.webhook.url, hasSecret: !!db.webhook.secret });
        io.emit('log', `🔗 Webhook salvo: ${data.url}`);
    });

    socket.on('regenerate-api-key', () => {
        db.apiKey = crypto.randomUUID();
        saveDB(db);
        io.emit('api-key', db.apiKey);
        io.emit('log', '🔑 Nova chave de API gerada.');
    });

    socket.on('test-webhook', async () => {
        if (!db.webhook?.url) {
            socket.emit('log', '⚠️ Configure uma URL de webhook primeiro.');
            return;
        }
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (db.webhook.secret) headers['X-Webhook-Secret'] = db.webhook.secret;
            await axios.post(db.webhook.url, {
                event: 'test',
                timestamp: new Date().toISOString(),
                data: { message: 'Teste de webhook do WhatsApp Bot' }
            }, { headers, timeout: 8000 });
            socket.emit('log', '✅ Webhook testado com sucesso!');
        } catch (err) {
            socket.emit('log', `❌ Falha no teste de webhook: ${err.message}`);
        }
    });
});

// WhatsApp eventos
client.on('qr', (qr) => {
    console.log('Novo QR Code gerado');
    qrCodeImage = qr;
    whatsappStatus = 'Aguardando Escaneamento';
    io.emit('qr', qr);
    io.emit('status', whatsappStatus);
});

client.on('authenticated', () => {
    console.log('Autenticado!');
    whatsappStatus = 'Autenticado, carregando...';
    qrCodeImage = null;
    io.emit('status', whatsappStatus);
});

client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação', msg);
    whatsappStatus = 'Falha na Autenticação';
    io.emit('status', whatsappStatus);
});

client.on('ready', () => {
    console.log('WhatsApp Pronto!');
    whatsappStatus = 'Conectado';
    qrCodeImage = null;
    io.emit('ready', true);
    io.emit('status', whatsappStatus);

    // Status atualizado localmente (opcional log)
    console.log('Bot Online e Pronto.');
});

client.on('message', async (msg) => {
    io.emit('message', { from: msg.from, body: msg.body, type: msg.type, timestamp: new Date().toISOString() });

    // Salva mensagem recebida Localmente
    db.logs.received.push({
        from: msg.from,
        body: msg.body || (msg.hasMedia ? `[Mídia: ${msg.type}]` : ''),
        timestamp: new Date().toISOString()
    });
    saveDB(db);

    // Webhook forwarding
    if (db.webhook?.url) {
        (async () => {
            try {
                let mediaPayload = null;
                if (msg.hasMedia) {
                    const media = await msg.downloadMedia().catch(() => null);
                    if (media) {
                        mediaPayload = { data: media.data, mimetype: media.mimetype, filename: media.filename || null };
                    }
                }
                const contact = await msg.getContact().catch(() => ({}));
                sendWebhook({
                    event: 'message_received',
                    timestamp: new Date().toISOString(),
                    data: {
                        from: msg.from,
                        fromName: contact.pushname || contact.name || '',
                        body: msg.body || '',
                        type: msg.type,
                        hasMedia: msg.hasMedia,
                        media: mediaPayload
                    }
                });
            } catch (e) {
                console.error('Webhook error:', e.message);
            }
        })();
    }

    // Lógica de Resposta Automática IA
    if (aiSettings.active) {
        const cleanIncoming = normalizePhone(msg.from.split('@')[0]);
        const last8Incoming = cleanIncoming.slice(-8);

        const cliente = clientesList.find(c => {
            const cleanDb = normalizePhone(c.telefone);
            const last8Db = cleanDb.slice(-8);
            return last8Db === last8Incoming;
        });

        // Resolve se deve responder: se replyAll for true OU se o cliente existir e tiver aiEnabled true
        const shouldReply = aiSettings.replyAll || (cliente && cliente.aiEnabled);

        if (shouldReply) {
            let userText = msg.body;
            let isAudioMessage = msg.type === 'audio' || msg.type === 'ptt';

            // Se for áudio, transcreve primeiro
            if (isAudioMessage && msg.hasMedia) {
                console.log(`🎤 Áudio (${msg.type}) recebido, aguardando download...`);
                io.emit('log', `🎤 Recebendo áudio...`);
                try {
                    const media = await msg.downloadMedia();
                    if (!media) throw new Error("Falha ao baixar mídia do áudio.");

                    const transcribedText = await transcribeAudio(media, aiSettings.apiKey);
                    if (transcribedText !== null && transcribedText !== undefined) {
                        userText = transcribedText;
                        io.emit('log', `📝 Áudio transcrito: "${userText}"`);
                    } else {
                        console.error("❌ Transcrição falhou.");
                        return;
                    }
                } catch (err) {
                    console.error("❌ Erro ao baixar ou transcrever áudio:", err.message);
                    io.emit('log', `⚠️ Erro no áudio: ${err.message}`);
                    return;
                }
            }

            if (!userText && !isAudioMessage) return;

            console.log(`🤖 IA processando para ${cleanIncoming}...`);
            try {
                // Busca histórico real do WhatsApp para contexto (últimas 12 mensagens)
                const chat = await msg.getChat();
                const lastMessages = await chat.fetchMessages({ limit: 12 });

                // Formata o histórico (exclui a mensagem atual para evitar duplicidade)
                const realContext = lastMessages
                    .filter(m => m.id._serialized !== msg.id._serialized)
                    .map(m => ({
                        role: m.fromMe ? 'assistant' : 'user',
                        content: m.body || (m.hasMedia ? "[Mídia]" : "")
                    }))
                    .filter(m => m.content.length > 0);

                const responseData = await getAIResponse(cleanIncoming, userText, isAudioMessage, realContext);

                if (responseData && responseData.text) {

                    if (isAudioMessage && responseData.audio) {
                        await chat.sendStateRecording();
                    } else {
                        await chat.sendStateTyping();
                    }

                    // Delay humano
                    const typingDelay = Math.min(Math.max(responseData.text.length * 60, 2000), 8000);
                    await new Promise(r => setTimeout(r, typingDelay));

                    // Envia Áudio ou Texto
                    if (isAudioMessage && responseData.audio) {
                        await client.sendMessage(msg.from, responseData.audio, { sendAudioAsVoice: true });
                        io.emit('log', `🎙️ IA (Voz) para ${cleanIncoming}: "${responseData.text}"`);
                    } else {
                        await client.sendMessage(msg.from, responseData.text);
                        io.emit('log', `🤖 IA para ${cleanIncoming}: "${responseData.text}"`);
                    }

                    db.logs.sent.push({
                        to: msg.from,
                        message: responseData.text,
                        type: isAudioMessage ? 'ai_voice_reply' : 'ai_auto_reply',
                        timestamp: new Date().toISOString()
                    });
                    saveDB(db);
                }
            } catch (aiErr) {
                console.error("❌ Erro IA:", aiErr.message);
            }
        }
    }
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp desconectado:', reason);
    whatsappStatus = 'Desconectado';
    io.emit('status', whatsappStatus);
    io.emit('log', `⚠️ WhatsApp desconectado: ${reason}. Reconectando em 10s...`);
    setTimeout(() => {
        client.initialize().catch(err => {
            console.error('Erro ao reconectar:', err);
            io.emit('log', `❌ Falha ao reconectar: ${err.message}`);
        });
    }, 10000);
});

// Iniciar servidor
server.listen(port, () => {
    console.log(`Interface rodando em http://localhost:${port}`);
    client.initialize().catch(err => {
        console.error('Erro ao iniciar cliente WhatsApp:', err);
        whatsappStatus = `Erro ao iniciar: ${err.message}`;
        io.emit('status', whatsappStatus);
        io.emit('log', `❌ Falha ao iniciar Chrome/WhatsApp: ${err.message}`);
    });
});
