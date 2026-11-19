// SPDX-License-Identifier: AGPL-3.0-only
import { connect } from 'node:net';

export class ScannerError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function command(host, port, request, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, host);
    let reply = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(new ScannerError('SCANNER_TIMEOUT')));
    socket.on('error', () => finish(new ScannerError('SCANNER_UNAVAILABLE')));
    socket.on('close', () => finish(new ScannerError('SCANNER_PROTOCOL')));
    socket.on('data', (part) => {
      reply = Buffer.concat([reply, part]);
      if (reply.length > 1024) return finish(new ScannerError('SCANNER_PROTOCOL'));
      const end = reply.indexOf(0);
      if (end !== -1) finish(null, reply.subarray(0, end).toString('utf8').trim());
    });
    socket.on('connect', () => {
      try { request(socket); }
      catch { finish(new ScannerError('SCANNER_PROTOCOL')); }
    });
  });
}

export function createClamAvScanner({ host = 'clamav', port = 3310, timeoutMs = 20_000 } = {}) {
  const options = { timeoutMs };
  return {
    async version() {
      const version = await command(host, port, (socket) => socket.write('zVERSION\0'), options);
      if (!/^ClamAV [\w.\-+/: ]{3,120}$/.test(version)) throw new ScannerError('SCANNER_PROTOCOL');
      const signatureDate = new Date(`${version.split('/').slice(2).join('/')} GMT`);
      if (!Number.isFinite(signatureDate.getTime())) throw new ScannerError('SCANNER_PROTOCOL');
      const age = Date.now() - signatureDate.getTime();
      if (age > 7 * 24 * 60 * 60_000 || age < -24 * 60 * 60_000) {
        throw new ScannerError('SCANNER_SIGNATURE_STALE');
      }
      return version;
    },
    async scan(body) {
      if (!Buffer.isBuffer(body) || body.length === 0 || body.length > 10 * 1024 * 1024) {
        throw new ScannerError('FILE_INTEGRITY_ERROR');
      }
      const engineVersion = await this.version();
      const reply = await command(host, port, (socket) => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < body.length; offset += 64 * 1024) {
          const chunk = body.subarray(offset, offset + 64 * 1024);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      }, options);
      if (reply === 'stream: OK') return { outcome: 'clean', engineVersion, scannedAt: new Date() };
      if (/^stream: .{1,200} FOUND$/.test(reply)) {
        return { outcome: 'infected', engineVersion, scannedAt: new Date() };
      }
      throw new ScannerError('SCANNER_PROTOCOL');
    },
  };
}
