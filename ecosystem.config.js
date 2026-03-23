module.exports = {
    apps: [{
        name: 'whasapp',
        script: 'index.js',
        cwd: '/opt/whasapp',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'vps',
            PORT: 3000,
            DATA_DIR: '/opt/whasapp/data',
            PUPPETEER_EXECUTABLE_PATH: '/usr/bin/google-chrome-stable',
        },
        error_file: '/opt/whasapp/logs/error.log',
        out_file: '/opt/whasapp/logs/out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }]
};
