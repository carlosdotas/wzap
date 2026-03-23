const socket = io();

const statusBadge = document.getElementById('status-badge');
const qrCanvas = document.getElementById('qr-canvas');
const qrPlaceholder = document.getElementById('qr-placeholder');
const authSection = document.getElementById('auth-section');
const controlSection = document.getElementById('control-section');
const logsContainer = document.getElementById('logs');

const phoneInput = document.getElementById('phone');
const messageInput = document.getElementById('message');
const sendBtn = document.getElementById('send-btn');
const resetBtn = document.getElementById('reset-btn');

// Bulk Elements
const bulkNumbersInput = document.getElementById('bulk-numbers');
const bulkMessageInput = document.getElementById('bulk-message');
const bulkDelayInput = document.getElementById('bulk-delay');
const sendBulkBtn = document.getElementById('send-bulk-btn');
const queueInfo = document.getElementById('queue-info');
const queueCount = document.getElementById('queue-count');

// Status Elements
const statusMessageInput = document.getElementById('status-message');
const sendStatusBtn = document.getElementById('send-status-btn');
const statusFileInput = document.getElementById('status-file');
const statusPreview = document.getElementById('status-preview');
const statusCanvas = document.getElementById('status-canvas');
const statusBgColor = document.getElementById('status-bg-color');
const statusTextColor = document.getElementById('status-text-color');
const statusFont = document.getElementById('status-font');

// Auto Status Elements
const autoStatusActive = document.getElementById('auto-status-active');
const autoStatusType = document.getElementById('auto-status-type');
const autoStatusPrompt = document.getElementById('auto-status-prompt');
const autoStatusThemes = document.getElementById('auto-status-themes');
const autoStatusInterval = document.getElementById('auto-status-interval');
const autoStatusStart = document.getElementById('auto-status-start');
const autoStatusEnd = document.getElementById('auto-status-end');
const saveAutoStatusBtn = document.getElementById('save-auto-status');
const autoStatusList = document.getElementById('auto-status-list');

// Schedule Elements
const schedulePhoneInput = document.getElementById('schedule-phone');
const scheduleDateTimeInput = document.getElementById('schedule-datetime');
const scheduleMessageInput = document.getElementById('schedule-message');
const scheduleBtn = document.getElementById('schedule-btn');
const scheduledListContainer = document.getElementById('scheduled-list');

// Clientes Elements
const clientesSidebarContainer = document.getElementById('clientes-sidebar-list');
const searchClientesInput = document.getElementById('search-clientes');
const importClientesBtn = document.getElementById('import-clientes-btn');

let selectedMedia = null;
let currentStatusMode = 'media';
let allClientes = [];

// Clientes List Sync
socket.on('clientes-list', (clientes) => {
    allClientes = clientes;
    renderClientes(clientes);
});

function formatPhoneForWhatsApp(phone) {
    let cleaned = phone.replace(/\D/g, '');

    // Se tiver 11 dígitos (ex: 11988887777), remove o terceiro dígito (o 9)
    if (cleaned.length === 11) {
        cleaned = cleaned.substring(0, 2) + cleaned.substring(3);
    }

    // Se não começar com 55 e tiver o tamanho de um número brasileiro (8 a 10 dígitos após limpeza), adiciona o 55
    if (!cleaned.startsWith('55') && cleaned.length >= 10 && cleaned.length <= 11) {
        cleaned = '55' + cleaned;
    } else if (!cleaned.startsWith('55') && cleaned.length === 10) {
        // Caso de 10 dígitos sem o 55
        cleaned = '55' + cleaned;
    }

    return cleaned;
}

function renderClientes(list) {
    clientesSidebarContainer.innerHTML = '';
    list.forEach(cliente => {
        const div = document.createElement('div');
        div.className = 'cliente-item';
        div.innerHTML = `
            <div class="cliente-info">
                <span class="nome">${cliente.nome || 'Sem Nome'}</span>
                <span class="telefone">${cliente.telefone || 'Sem Telefone'}</span>
            </div>
            <button class="ai-toggle-btn ${cliente.aiEnabled ? 'active' : ''}" title="Alternar Resposta IA">
                🤖
            </button>
        `;

        // Clique na info para preencher número
        div.querySelector('.cliente-info').addEventListener('click', () => {
            const phone = formatPhoneForWhatsApp(cliente.telefone || '');
            const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
            if (activeTab === 'single') phoneInput.value = phone;
            if (activeTab === 'schedule') schedulePhoneInput.value = phone;
            if (activeTab === 'bulk') {
                const current = bulkNumbersInput.value.trim();
                bulkNumbersInput.value = current ? current + '\n' + phone : phone;
            }
        });

        // Clique no botão de IA
        div.querySelector('.ai-toggle-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const newState = !cliente.aiEnabled;
            socket.emit('toggle-ai-client', { id: cliente.id, enabled: newState });
        });

        clientesSidebarContainer.appendChild(div);
    });
}

// Search Logic
searchClientesInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allClientes.filter(c =>
        (c.nome || '').toLowerCase().includes(term) ||
        (c.telefone || '').includes(term)
    );
    renderClientes(filtered);
});

// Import All Logic
importClientesBtn.addEventListener('click', () => {
    const phones = allClientes
        .map(c => formatPhoneForWhatsApp(c.telefone || ''))
        .filter(p => p.length >= 8);
    bulkNumbersInput.value = phones.join('\n');
    addLog(`${phones.length} telefones formatados e importados.`);
});

// Subtab Logic
document.querySelectorAll('[data-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
        const parent = btn.closest('.tab-content');
        parent.querySelectorAll('[data-subtab]').forEach(b => b.classList.remove('active'));
        parent.querySelectorAll('.subtab-content').forEach(c => c.classList.add('hidden'));

        btn.classList.add('active');
        const mode = btn.dataset.subtab;
        currentStatusMode = mode;
        document.getElementById(`subtab-${mode}`).classList.remove('hidden');

        if (mode === 'text') {
            updateTextStatusPreview();
        } else if (!selectedMedia) {
            statusPreview.classList.add('hidden');
        }
    });
});

// Canvas Status Generator
function updateTextStatusPreview() {
    if (currentStatusMode !== 'text') return;

    const ctx = statusCanvas.getContext('2d');
    const text = statusMessageInput.value || 'Seu Status Aqui';
    const bgColor = statusBgColor.value;
    const textColor = statusTextColor.value;
    const font = statusFont.value;

    // Fundo
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, statusCanvas.width, statusCanvas.height);

    // Texto
    ctx.fillStyle = textColor;
    ctx.font = `bold 80px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Quebra de linha simples
    const lines = text.split('\n');
    const lineHeight = 100;
    const startY = (statusCanvas.height / 2) - ((lines.length - 1) * lineHeight / 2);

    lines.forEach((line, i) => {
        ctx.fillText(line, statusCanvas.width / 2, startY + (i * lineHeight));
    });

    const dataUrl = statusCanvas.toDataURL('image/png');
    statusPreview.classList.remove('hidden');
    statusPreview.innerHTML = `<img src="${dataUrl}" style="max-height: 300px; border: 2px solid white;">`;

    selectedMedia = {
        media: dataUrl,
        mimetype: 'image/png',
        filename: 'status.png'
    };
}

[statusBgColor, statusTextColor, statusFont, statusMessageInput].forEach(el => {
    el.addEventListener('input', () => {
        if (currentStatusMode === 'text') updateTextStatusPreview();
    });
});

// File Preview Logic
statusFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 16 * 1024 * 1024) { // 16MB limit for WhatsApp
            alert('Arquivo muito grande! O limite para o WhatsApp é de 16MB.');
            statusFileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            selectedMedia = {
                media: event.target.result,
                mimetype: file.type,
                filename: file.name
            };

            statusPreview.classList.remove('hidden');
            if (file.type.startsWith('image/')) {
                statusPreview.innerHTML = `<img src="${event.target.result}">`;
            } else if (file.type.startsWith('video/')) {
                statusPreview.innerHTML = `<video src="${event.target.result}" controls></video>`;
            }
        };
        reader.readAsDataURL(file);
    }
});

// Tab Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}-tab`).classList.remove('hidden');
    });
});

// Atualiza o status visual
socket.on('status', (status) => {
    statusBadge.innerText = status;

    if (status === 'Conectado') {
        statusBadge.classList.add('connected');
        authSection.classList.add('hidden');
        controlSection.classList.remove('hidden');
    } else if (status === 'Reiniciando...') {
        statusBadge.classList.remove('connected');
        qrCanvas.classList.add('hidden');
        qrPlaceholder.classList.remove('hidden');
        qrPlaceholder.innerText = 'Reiniciando engine...';
    } else {
        statusBadge.classList.remove('connected');
        authSection.classList.remove('hidden');
        controlSection.classList.add('hidden');
    }
});

// Queue Updates
socket.on('queue-status', (data) => {
    if (data.remaining > 0) {
        queueInfo.classList.remove('hidden');
        queueCount.innerText = data.remaining;
        if (data.next) {
            addLog(`Fila: Próximo envio para ${data.next} em ${data.nextDelay}s`);
        }
    } else {
        queueInfo.classList.add('hidden');
    }
});

// Renderiza o QR Code
socket.on('qr', (qr) => {
    qrPlaceholder.classList.add('hidden');
    qrCanvas.classList.remove('hidden');
    QRCode.toCanvas(qrCanvas, qr, { width: 200 }, (error) => {
        if (error) console.error(error);
    });
    addLog('Novo QR Code recebido, aguardando escaneamento.');
});

// Quando o WhatsApp está pronto
socket.on('ready', () => {
    addLog('WhatsApp conectado com sucesso!');
});

// Mensagens recebidas
socket.on('message', (data) => {
    addLog(`Mensagem de ${data.from}: ${data.body}`, 'message');
});

// Logs genéricos
socket.on('log', (text) => {
    addLog(text);
});

// Enviar mensagem individual
sendBtn.addEventListener('click', () => {
    const number = phoneInput.value.trim();
    const message = messageInput.value.trim();

    if (!number || !message) {
        alert('Preencha o número e a mensagem!');
        return;
    }

    socket.emit('send-message', { number, message });
    messageInput.value = '';
    addLog(`Solicitado envio para ${number}`);
});

// Enviar em Massa
sendBulkBtn.addEventListener('click', () => {
    const rawNumbers = bulkNumbersInput.value.trim();
    const message = bulkMessageInput.value.trim();
    const delay = parseInt(bulkDelayInput.value);

    if (!rawNumbers || !message) {
        alert('Preencha os números e a mensagem!');
        return;
    }

    const numbers = rawNumbers.split('\n').filter(n => n.trim() !== '');
    socket.emit('send-bulk', { numbers, message, delay });

    bulkNumbersInput.value = '';
    bulkMessageInput.value = '';
});

// Enviar Status
sendStatusBtn.addEventListener('click', () => {
    const message = statusMessageInput.value.trim();

    if (!message && !selectedMedia) {
        alert('O texto do status ou uma mídia deve ser fornecido!');
        return;
    }

    const payload = {
        message,
        ...(selectedMedia || {})
    };

    socket.emit('send-status', payload);

    // Limpar campos
    statusMessageInput.value = '';
    statusFileInput.value = '';
    statusPreview.classList.add('hidden');
    statusPreview.innerHTML = '';
    selectedMedia = null;
});

// Schedule message
scheduleBtn.addEventListener('click', () => {
    const number = schedulePhoneInput.value.trim();
    const datetime = scheduleDateTimeInput.value;
    const message = scheduleMessageInput.value.trim();

    if (!number || !datetime || !message) {
        alert('Preencha todos os campos para agendar!');
        return;
    }

    socket.emit('schedule-message', { number, datetime, message });

    // Clear
    schedulePhoneInput.value = '';
    scheduleDateTimeInput.value = '';
    scheduleMessageInput.value = '';
});

// Update Scheduled List UI
socket.on('scheduled-list', (list) => {
    scheduledListContainer.innerHTML = '';
    list.sort((a, b) => new Date(a.datetime) - new Date(b.datetime)).forEach(item => {
        const div = document.createElement('div');
        div.className = `scheduled-item ${item.sent ? 'sent' : 'pending'}`;
        div.innerHTML = `
            <div><strong>${item.number}</strong>: ${item.message.substring(0, 30)}...</div>
            <span class="time">${new Date(item.datetime).toLocaleString()} - ${item.sent ? '✓ Enviado' : '⏳ Aguardando'}</span>
        `;
        scheduledListContainer.appendChild(div);
    });
});

// IA Elements
const aiApiKeyInput = document.getElementById('ai-api-key');
const aiPromptInput = document.getElementById('ai-prompt');
const aiModelSelect = document.getElementById('ai-model');
const aiActiveSelect = document.getElementById('ai-active');
const aiReplyAllSelect = document.getElementById('ai-reply-all');
const aiVoiceSelect = document.getElementById('ai-voice');
const saveAiBtn = document.getElementById('save-ai-settings');
const aiUsersSelectionList = document.getElementById('ai-users-selection-list');
const aiSearchUsersInput = document.getElementById('ai-search-users');
const aiSelectAllBtn = document.getElementById('ai-select-all');
const aiDeselectAllBtn = document.getElementById('ai-deselect-all');

// IA Settings Sync
socket.on('ai-settings', (data) => {
    console.log("Recebido ai-settings:", data);
    if (data.apiKey !== undefined) aiApiKeyInput.value = data.apiKey;
    if (data.prompt !== undefined) aiPromptInput.value = data.prompt;
    if (data.model !== undefined) aiModelSelect.value = data.model;
    if (data.active !== undefined) aiActiveSelect.value = data.active.toString();
    if (data.replyAll !== undefined) aiReplyAllSelect.value = data.replyAll.toString();
    if (data.voice !== undefined) aiVoiceSelect.value = data.voice;
});

saveAiBtn.addEventListener('click', () => {
    const data = {
        apiKey: aiApiKeyInput.value.trim(),
        prompt: aiPromptInput.value.trim(),
        model: aiModelSelect.value,
        active: aiActiveSelect.value,
        replyAll: aiReplyAllSelect.value,
        voice: aiVoiceSelect.value
    };
    console.log("Enviando save-ai-settings:", data);
    socket.emit('save-ai-settings', data);
});

// Auto Status Sync & Save
socket.on('auto-status-settings', (data) => {
    if (data.active !== undefined) autoStatusActive.value = data.active.toString();
    if (data.type !== undefined) autoStatusType.value = data.type;
    if (data.prompt !== undefined) autoStatusPrompt.value = data.prompt;
    if (data.themes !== undefined) autoStatusThemes.value = data.themes;
    if (data.interval !== undefined) autoStatusInterval.value = data.interval;
    if (data.startTime !== undefined) autoStatusStart.value = data.startTime;
    if (data.endTime !== undefined) autoStatusEnd.value = data.endTime;
});

socket.on('auto-status-logs', (logs) => {
    renderAutoStatusLogs(logs);
});

saveAutoStatusBtn.addEventListener('click', () => {
    const data = {
        active: autoStatusActive.value === 'true',
        type: autoStatusType.value,
        prompt: autoStatusPrompt.value.trim(),
        themes: autoStatusThemes.value.trim(),
        interval: parseInt(autoStatusInterval.value),
        startTime: autoStatusStart.value,
        endTime: autoStatusEnd.value
    };
    socket.emit('save-auto-status', data);
});

function renderAutoStatusLogs(logs) {
    autoStatusList.innerHTML = '';
    if (!logs) return;
    const reversedLogs = [...logs].reverse();
    reversedLogs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'scheduled-item sent';
        div.innerHTML = `
            <div class="content"><strong>${log.type === 'image' ? '🖼️ Imagem' : '📄 Texto'}:</strong> ${log.content}</div>
            <div class="time">${new Date(log.timestamp).toLocaleString()}</div>
        `;
        autoStatusList.appendChild(div);
    });
}

// Update AI Selection List UI
function renderAiSelectionList(list) {
    aiUsersSelectionList.innerHTML = '';
    list.forEach(user => {
        const card = document.createElement('div');
        card.className = `ai-user-card ${user.aiEnabled ? 'selected' : ''}`;
        card.innerHTML = `
            <input type="checkbox" ${user.aiEnabled ? 'checked' : ''}>
            <div class="user-details">
                <span class="name">${user.nome || 'Sem Nome'}</span>
                <span class="phone">${user.telefone || ''}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            const checkbox = card.querySelector('input');
            checkbox.checked = !checkbox.checked;
            socket.emit('toggle-ai-client', { id: user.id, enabled: checkbox.checked });
        });

        card.querySelector('input').addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('toggle-ai-client', { id: user.id, enabled: e.target.checked });
        });

        aiUsersSelectionList.appendChild(card);
    });
}

// Clientes List Sync - Updates both Sidebar and AI Tab
socket.on('clientes-list', (clientes) => {
    allClientes = clientes;
    renderClientes(clientes);
    renderAiSelectionList(clientes);
});

// AI User Search
aiSearchUsersInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allClientes.filter(c =>
        (c.nome || '').toLowerCase().includes(term) ||
        (c.telefone || '').includes(term)
    );
    renderAiSelectionList(filtered);
});

// Select All / Deselect All
aiSelectAllBtn.addEventListener('click', () => {
    const visibleUsers = allClientes.filter(c => {
        const term = aiSearchUsersInput.value.toLowerCase();
        return (c.nome || '').toLowerCase().includes(term) || (c.telefone || '').includes(term);
    });

    if (confirm(`Habilitar IA para ${visibleUsers.length} usuários?`)) {
        socket.emit('toggle-ai-bulk', { ids: visibleUsers.map(u => u.id), enabled: true });
    }
});

aiDeselectAllBtn.addEventListener('click', () => {
    const visibleUsers = allClientes.filter(c => {
        const term = aiSearchUsersInput.value.toLowerCase();
        return (c.nome || '').toLowerCase().includes(term) || (c.telefone || '').includes(term);
    });

    if (confirm(`Desabilitar IA para ${visibleUsers.length} usuários?`)) {
        socket.emit('toggle-ai-bulk', { ids: visibleUsers.map(u => u.id), enabled: false });
    }
});

resetBtn.addEventListener('click', () => {
    if (confirm('Deseja realmente reiniciar a conexão? Isso fechará a sessão atual.')) {
        socket.emit('reset-connection');
    }
});

const clearSessionBtn = document.getElementById('clear-session-btn');
clearSessionBtn.addEventListener('click', () => {
    if (confirm('Isso irá APAGAR a sessão salva e desconectar o WhatsApp.\nVocê precisará escanear o QR Code novamente.\n\nConfirmar?')) {
        socket.emit('clear-session');
    }
});

function addLog(text, type = 'system') {
    const div = document.createElement('div');
    div.classList.add('log-entry', type);
    div.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
    logsContainer.prepend(div);
}
