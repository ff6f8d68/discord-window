import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));
app.get('/health', (req, res) => res.status(200).send('OK'));

wss.on('connection', async (ws) => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process', // Minimizes RAM overhead
      '--no-zygote'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // 1. Attach directly to the Chrome DevTools Protocol (CDP) session
  const cdp = await page.target().createCDPSession();

  // 2. Listen for native compositor frame events
  cdp.on('Page.screencastFrame', async (frame) => {
    if (ws.readyState === ws.OPEN) {
      // Send raw base64 frame buffer
      ws.send(frame.data);
    }
    // Acknowledge the frame to keep Chrome streaming smoothly
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch (e) {
      // Ignore if session closed
    }
  });

  // 3. Start high-frequency screencast
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 55,           // Slightly lower quality dramatically boosts FPS
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1       // Capture every painted frame
  });

  // Handle client input events
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

server.listen(3000, () => console.log('60 FPS Virtual Engine running on http://localhost:3000'));
