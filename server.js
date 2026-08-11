import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));
app.get('/health', (req, res) => res.status(200).send('OK'));

wss.on('connection', async (ws, req) => {
  let browser = null;
  let cdp = null;

  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let targetUrl = parsedUrl.searchParams.get('site') || 'https://youtube.com';
    
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    // Launch using @sparticuz/chromium for cloud/Render environments
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-gpu',
        '--window-size=1280,720'
      ],
      defaultViewport: { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    cdp = await page.target().createCDPSession();

    cdp.on('Page.screencastFrame', async (frame) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(frame.data);
      }
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
      } catch (e) {}
    });

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 1
    });

    page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
      console.error('Navigation warning:', err.message);
    });

    ws.on('message', async (data) => {
      try {
        if (!page.isClosed()) {
          const msg = JSON.parse(data);
          if (msg.type === 'click') {
            await page.mouse.click(msg.x, msg.y);
          } else if (msg.type === 'keydown') {
            await page.keyboard.press(msg.key);
          }
        }
      } catch (e) {}
    });

  } catch (err) {
    console.error('Fatal WS Connection Error:', err.message);
    if (ws.readyState === ws.OPEN) ws.close();
    if (browser) await browser.close().catch(() => {});
    return;
  }

  ws.on('close', async () => {
    try {
      if (cdp) await cdp.send('Page.stopScreencast').catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } catch (e) {}
  });
});

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Virtual Browser active on port ${PORT}`));
