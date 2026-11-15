import fs from 'fs';
import zlib from 'zlib';

function createPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  // Signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw image data with filter byte 0 per scanline
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      // Draw a subtle border and brand color fill
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (isBorder) {
        rawData[pixelOffset] = 88;     // R (#58a6ff)
        rawData[pixelOffset + 1] = 166; // G
        rawData[pixelOffset + 2] = 255; // B
        rawData[pixelOffset + 3] = 255; // A
      } else {
        rawData[pixelOffset] = rgba[0];
        rawData[pixelOffset + 1] = rgba[1];
        rawData[pixelOffset + 2] = rgba[2];
        rawData[pixelOffset + 3] = rgba[3];
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeInt32BE(crc, 8 + len);
  return chunk;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (-(c & 1) & 0xEDB88320);
    }
  }
  return ~c;
}

// Generate brand reference PNG (256x256 Charcoal/Dark Slate #161b22 with #58a6ff border)
const pngBuf = createPng(256, 256, [22, 27, 34, 255]);
fs.mkdirSync('assets/brand', { recursive: true });
fs.mkdirSync('public/assets/brand', { recursive: true });
fs.writeFileSync('assets/brand/manifest-brand-reference.png', pngBuf);
fs.writeFileSync('public/assets/brand/manifest-brand-reference.png', pngBuf);

// Also copy SVGs to public/assets/brand so they are served by Vite web server
const brandFiles = [
  'manifest-symbol.svg',
  'manifest-wordmark.svg',
  'manifest-logo-dark.svg',
  'manifest-logo-light.svg',
  'manifest-icon.svg',
  'favicon.svg',
];
for (const f of brandFiles) {
  if (fs.existsSync(`assets/brand/${f}`)) {
    fs.copyFileSync(`assets/brand/${f}`, `public/assets/brand/${f}`);
  }
}

console.log('✓ Successfully generated assets/brand/manifest-brand-reference.png and mirrored to public/assets/brand');
