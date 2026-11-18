import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { createLocationStore } from './src/locations.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const publicUrl = new URL(process.env.PUBLIC_URL ?? `http://localhost:${port}/`);
const locations = createLocationStore(process.env.DATA_DIR ?? fileURLToPath(new URL('../../data/', import.meta.url)));
const mimeTypes: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
};

const server = createServer(async (request, response) => {
  const path = request.url?.split('?')[0];
  const method = request.method;

  try {
    if (method === 'POST' && (path === '/api/geocode' || path === '/api/regeocode')) {
      // Require a header that a cross-origin browser request cannot send without CORS permission.
      if (request.headers['x-map-request'] !== '1') {
        response.writeHead(403).end();
        return;
      }
      const data = await locations.geocode(path === '/api/regeocode');
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
      return;
    }

    if (method === 'GET' && path === '/api/locations') {
      const data = await locations.directory();
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
      return;
    }

    if (method === 'GET' && path === '/qr.png') {
      const png = await QRCode.toBuffer(publicUrl.href, { width: 320 });
      response.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
      return;
    }

    if (method === 'GET' && path === '/') {
      const html = await readFile(new URL('../../public/index.html', import.meta.url));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      return;
    }

    const asset = method === 'GET' && path?.match(/^\/assets\/([\w-]+\.(js|css|png))$/);
    if (asset) {
      const file = await readFile(new URL(`../public/assets/${asset[1]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': mimeTypes[asset[2]] }).end(file);
      return;
    }

    response.writeHead(404).end('Not found');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && path?.startsWith('/assets/')) {
      response.writeHead(404).end('Not found');
      return;
    }
    console.error(error);
    response.writeHead(500).end('The request could not be completed.');
  }
});

server.listen(port, host, () => console.log(`Niagara Falls Services Map running at http://${host}:${port}/`));
