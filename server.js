import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));

wss.on('connection', async (ws) => {
  // Launch a real Chromium instance on the server
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,720'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Stream JPEG frame buffer to the client canvas
  let isStreaming = true;
  const renderLoop = async () => {
    while (isStreaming && ws.readyState === ws.OPEN) {
      try {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 65 });
        ws.send(buffer);
      } catch (err) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 66)); // ~15 FPS
    }
  };

  // Handle inbound interactions from client
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'navigate') {
        await page.goto(msg.url, { waitUntil: 'domcontentloaded' });
      } else if (msg.type === 'click') {
        await page.mouse.click(msg.x, msg.y);
      } else if (msg.type === 'keydown') {
        await page.keyboard.press(msg.key);
      }
    } catch (e) {
      console.error('Interaction error:', e.message);
    }
  });

  renderLoop();

  ws.on('close', async () => {
    isStreaming = false;
    await browser.close();
  });
});

server.listen(3000, () => console.log('Virtual Browser running on http://localhost:3000'));
