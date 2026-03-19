const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.NODE_ENV === 'production'
    ? '/tmp/db.json'
    : path.join(__dirname, 'db.json');

const defaultData = {
    scheduledMessages: [],
    aiSettings: { active: false, prompt: '', apiKey: '' },
    users: {}, // Local data for users (like aiEnabled)
    logs: {
        sent: [],
        received: []
    },
    autoStatus: {
        active: false,
        prompt: "Crie uma frase motivacional curta sobre os temas abaixo para o status do WhatsApp.",
        themes: "Tecnologia, Inovação, Empreendedorismo",
        interval: 60,
        startTime: "08:00",
        endTime: "22:00",
        type: "text",
        logs: []
    }
};

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Erro ao carregar DB local:", e.message);
        return defaultData;
    }
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Erro ao salvar DB local:", e.message);
    }
}

module.exports = { loadDB, saveDB };
