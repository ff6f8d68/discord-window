import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer';
import { parse } from 'url';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));
app.get('/health', (req, res) => res.status(200).send('OK'));

wss.on('connection', async (ws, req) => {
  // 1. Extract ?site= directly from the WebSocket handshake URL
  const { query } = parse(req.url, true);
  let targetUrl = query.site || 'https://youtube.com';
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  // 2. Launch headless browser
  const browser = await puppeteer.launch({
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--window-size=1280,720'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // 3. Attach Chrome DevTools Protocol Screencast
  const cdp = await page.target().createCDPSession();

  cdp.on('Page.screencastFrame', async (frame) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(frame.data);
    }
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch (e) {}
  });

  // 4. Start high-performance streaming
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 60,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1
  });

  // 5. Navigate immediately on connection
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.error('Initial navigation error:', err.message);
  }

  // Handle client mouse and keyboard inputs
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'click') {
        await page.mouse.click(msg.x, msg.y);
      } else if (msg.type === 'keydown') {
        await page.keyboard.press(msg.key);
      }
    } catch (e) {
      console.error('Input Error:', e.message);
    }
  });

  ws.on('close', async () => {
    try {
      await cdp.send('Page.stopScreencast');
    } catch (e) {}
    await browser.close();
  });
});

server.listen(3000, () => console.log('Virtual Browser running on http://localhost:3000'));
