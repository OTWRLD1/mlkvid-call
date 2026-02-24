# VideoCall — Видеозвонки в браузере

## Быстрый старт

### 1. Установка на VPS

```bash
# Обновить систему
sudo apt update && sudo apt upgrade -y

# Установить Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Клонировать/скопировать проект
mkdir video-call && cd video-call
# (скопируйте все файлы сюда)

# Установить зависимости
npm install

# Запустить
npm start
``` 

2. HTTPS — ОБЯЗАТЕЛЬНО!
WebRTC не работает без HTTPS (кроме localhost).
Есть два способа:

Способ A: Nginx + Let's Encrypt (рекомендуется)
```bash
# Установить Nginx и Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Настроить домен (A-запись должна указывать на IP сервера)
# Создать конфиг Nginx:
sudo nano /etc/nginx/sites-available/videocall
```
Конфигурация Nginx:

```nginx
server {
    listen 80;
    server_name ваш-домен.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

```bash
# Активировать и получить сертификат
sudo ln -s /etc/nginx/sites-available/videocall /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d ваш-домен.com
```
Способ B: Без домена (самоподписанный сертификат)
Замените server.js на HTTPS-версию:

```javascript
const https = require('https');
const fs = require('fs');

// Генерация сертификата:
// openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
};

const server = https.createServer(options, app);
```

```bash
# Сгенерировать самоподписанный сертификат
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

При входе браузер покажет предупреждение — нажмите «Дополнительно» → «Перейти».

3. Запуск в фоне (PM2)
```bash
# Установить PM2
sudo npm install -g pm2

# Запустить приложение
pm2 start server.js --name videocall

# Автозапуск при перезагрузке
pm2 startup
pm2 save

# Полезные команды
pm2 status          # Статус
pm2 logs videocall  # Логи
pm2 restart videocall  # Перезапуск
```

4. Открыть порты (если нет Nginx)
```bash
sudo ufw allow 3000
sudo ufw allow 443
sudo ufw allow 80
```

## Использование
Откройте https://ваш-домен.com (или https://IP:3000)
Введите имя и создайте комнату
Поделитесь ссылкой с собеседником
Разрешите доступ к камере и микрофону

## Поддерживаемые браузеры
Chrome 70+
Firefox 60+
Safari 14+
Edge 79+
Мобильные браузеры (Chrome, Safari)

## Возможности
- Видео и аудио звонки
- До 10 участников
- Демонстрация экрана
- Включение/выключение камеры и микрофона
- Адаптивная сетка видео
- Таймер звонка
- Копирование ссылки приглашения
- P2P шифрование (WebRTC)

---

## Как это работает

1. **Сигнализация** — Socket.IO передаёт SDP-офферы и ICE-кандидаты между участниками
2. **WebRTC** — после установки соединения аудио/видео идёт напрямую между браузерами (P2P), не через сервер
3. **Mesh-топология** — каждый участник соединён с каждым (подходит для ≤10 человек)

## Критически важно

**HTTPS обязателен!** Браузеры блокируют доступ к камере/микрофону на HTTP (кроме localhost). Без HTTPS видеозвонки работать не будут.
