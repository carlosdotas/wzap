# WhatsApp Connection System (No Official API)

Este sistema utiliza a biblioteca `whatsapp-web.js` para conectar ao WhatsApp Web de forma automatizada via Puppeteer.

## Requisitos

- [Node.js](https://nodejs.org/) instalado.
- Um celular com WhatsApp para escanear o QR Code.

## Como usar

1.  Abra o terminal na pasta do projeto (`c:\xampp\htdocs\whasapp`).
2.  Instale as dependências (se ainda não fez):
    ```bash
    npm install
    ```
3.  Inicie o sistema:
    ```bash
    npm start
    ```
4.  Aguarde o QR Code aparecer no terminal e escaneie-o com o seu WhatsApp (Menu > Aparelhos Conectados > Conectar um aparelho).

## Funcionalidades implementadas

- **Conexão Persistente**: Utiliza `LocalAuth` para salvar a sessão. Você só precisa escanear o QR Code uma vez.
- **Resposta Automática**:
  - Responde "Oi" com uma saudação.
  - Responde "!status" informando que o sistema está online.
- **Logs no Terminal**: Mostra as mensagens recebidas para facilitar o debug.

## Avisos Legais

O uso desta biblioteca não é oficial e pode violar os Termos de Serviço do WhatsApp se for usado para spam ou comportamentos abusivos. Use com responsabilidade.
