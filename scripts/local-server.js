import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import apiHandler from '../api/index.js';
import telegramHandler from '../api/telegram.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function adapt(response) {
  response.status = code => { response.statusCode = code; return response; };
  response.json = data => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)); return response; };
  return response;
}

http.createServer(async (request, originalResponse) => {
  const response = adapt(originalResponse);
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      request.body = raw ? JSON.parse(raw) : null;
      request.query = Object.fromEntries(url.searchParams);
      if (url.pathname === '/api' || url.pathname === '/api/index') return apiHandler(request, response);
      if (url.pathname === '/api/telegram') return telegramHandler(request, response);
      return response.status(404).json({ ok: false });
    } catch (error) {
      return response.status(400).json({ ok: false, error: error.message });
    }
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['index.html', 'styles.css', 'app.js'].includes(name)) {
    response.statusCode = 404; response.end('Not found'); return;
  }
  try {
    const content = await readFile(path.join(root, name));
    response.setHeader('Content-Type', types[path.extname(name)]);
    response.end(content);
  } catch {
    response.statusCode = 404; response.end('Not found');
  }
}).listen(Number(process.env.PORT ?? 3000), () => console.log(`Finance desk listening on http://localhost:${process.env.PORT ?? 3000}`));
