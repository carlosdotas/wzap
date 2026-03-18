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

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Garantir que a pasta tmp exista
const tmpDir = path.join(__dirname, 'tmp');
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

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "client-one" // Define um ID fixo para a sessão
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ],
    }
});

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Inicializa Banco de Dados Local
let db = loadDB();

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
        const tempPath = path.join(__dirname, 'tmp', `audio_${Date.now()}.ogg`);
        const mp3Path = path.join(__dirname, 'tmp', `audio_${Date.now()}.mp3`);

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
    const mp3Path = path.join(__dirname, 'tmp', `tts_${Date.now()}.mp3`);
    const oggPath = path.join(__dirname, 'tmp', `tts_${Date.now()}.ogg`);

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
    io.emit('message', { from: msg.from, body: msg.body });

    // Salva mensagem recebida Localmente
    db.logs.received.push({
        from: msg.from,
        body: msg.body || (msg.hasMedia ? `[Mídia: ${msg.type}]` : ''),
        timestamp: new Date().toISOString()
    });
    saveDB(db);

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
    client.initialize().catch(err => console.error('Erro ao reconectar:', err));
});

// Iniciar servidor
server.listen(port, () => {
    console.log(`Interface rodando em http://localhost:${port}`);
    client.initialize().catch(err => console.error('Erro ao iniciar cliente WhatsApp:', err));
});
