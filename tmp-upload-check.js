const http = require('http');
const crypto = require('crypto');
const handler = require('./api/admin/upload.js');

const payload = { exp: Date.now() + 3600000, iat: Date.now() };
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signature = crypto.createHmac('sha256', process.env.ADMIN_JWT_SECRET).update(encoded).digest('hex');
const token = `${encoded}.${signature}`;
const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const body = [
  '--' + boundary,
  'Content-Disposition: form-data; name="title"',
  '',
  'Test Title',
  '--' + boundary,
  'Content-Disposition: form-data; name="category"',
  '',
  'Chrome',
  '--' + boundary,
  'Content-Disposition: form-data; name="photos"; filename="test.png"',
  'Content-Type: image/png',
  '',
  'fake-image-data',
  '--' + boundary + '--',
  ''
].join('\r\n');

const server = http.createServer((req, res) => handler(req, res));
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const request = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      authorization: `Bearer ${token}`,
    },
  }, (response) => {
    let data = '';
    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => {
      console.log(JSON.stringify({ statusCode: response.statusCode, body: data }));
      server.close();
    });
  });

  request.write(body);
  request.end();
});
