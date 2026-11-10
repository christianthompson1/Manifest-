/**
 * Manifest Studio - Binary File Signatures and Format Detection
 *
 * Provides safe classification of files based on:
 * - Known file extensions
 * - Data URI MIME headers
 * - Binary magic byte signatures (MBC, WASM, PNG, JPEG, GIF, WEBP, ZIP)
 */

export interface FileClassification {
  category: 'image' | 'audio' | 'video' | 'csv' | 'markdown' | 'binary' | 'code' | 'text';
  mimeType: string;
  formatName: string;
  isBinary: boolean;
  isKnownExecutable: boolean;
}

export interface HexDumpRow {
  offset: string;
  hexBytes: string[];
  ascii: string;
}

export function detectFileClassification(path: string, mimeType?: string, content?: string): FileClassification {
  const ext = path.split('.').pop()?.toLowerCase() || '';

  // 1. Check known MIME or extensions for Image
  if (
    mimeType?.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)
  ) {
    let resolvedMime = mimeType || `image/${ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext}`;
    let format = ext.toUpperCase();
    if (ext === 'svg') format = 'Scalable Vector Graphics (SVG)';
    return {
      category: 'image',
      mimeType: resolvedMime,
      formatName: `${format} Image`,
      isBinary: ext !== 'svg',
      isKnownExecutable: false,
    };
  }

  // 2. Audio
  if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) {
    return {
      category: 'audio',
      mimeType: mimeType || `audio/${ext}`,
      formatName: `${ext.toUpperCase()} Audio`,
      isBinary: true,
      isKnownExecutable: false,
    };
  }

  // 3. Video
  if (mimeType?.startsWith('video/') || ['mp4', 'webm', 'ogv', 'mov'].includes(ext)) {
    return {
      category: 'video',
      mimeType: mimeType || `video/${ext}`,
      formatName: `${ext.toUpperCase()} Video`,
      isBinary: true,
      isKnownExecutable: false,
    };
  }

  // 4. CSV
  if (ext === 'csv' || mimeType === 'text/csv') {
    return {
      category: 'csv',
      mimeType: 'text/csv',
      formatName: 'Comma-Separated Values (CSV)',
      isBinary: false,
      isKnownExecutable: false,
    };
  }

  // 5. Markdown
  if (ext === 'md' || ext === 'markdown') {
    return {
      category: 'markdown',
      mimeType: 'text/markdown',
      formatName: 'Markdown Document',
      isBinary: false,
      isKnownExecutable: false,
    };
  }

  // 6. Compiled Bytecode / Binaries
  if (ext === 'mbc' || mimeType === 'application/x-manifest-bytecode') {
    return {
      category: 'binary',
      mimeType: 'application/x-manifest-bytecode',
      formatName: 'Manifest Portable Bytecode Container (v1.0 MBC)',
      isBinary: true,
      isKnownExecutable: true,
    };
  }

  if (ext === 'wasm' || mimeType === 'application/wasm') {
    return {
      category: 'binary',
      mimeType: 'application/wasm',
      formatName: 'WebAssembly Binary Module (WASM)',
      isBinary: true,
      isKnownExecutable: true,
    };
  }

  if (['bin', 'dat', 'iso', 'so', 'dylib', 'dll', 'class'].includes(ext) || content?.startsWith('data:application/octet-stream')) {
    return {
      category: 'binary',
      mimeType: mimeType || 'application/octet-stream',
      formatName: 'Raw Binary Data',
      isBinary: true,
      isKnownExecutable: false,
    };
  }

  // 7. General text / code
  return {
    category: 'code',
    mimeType: mimeType || 'text/plain',
    formatName: `${ext.toUpperCase()} Source`,
    isBinary: false,
    isKnownExecutable: false,
  };
}

/**
 * Extracts raw Uint8Array from either data URI base64 or raw string.
 */
export function extractBytesFromContent(content: string): Uint8Array {
  if (content.startsWith('data:')) {
    const commaIdx = content.indexOf(',');
    if (commaIdx !== -1) {
      const base64 = content.slice(commaIdx + 1);
      try {
        const binStr = atob(base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        return bytes;
      } catch {
        // Fallback to text encoding
      }
    }
  }

  const enc = new TextEncoder();
  return enc.encode(content);
}

/**
 * Generates structured 16-bytes-per-row HexDump rows.
 */
export function generateHexDump(bytes: Uint8Array, maxRows = 256): HexDumpRow[] {
  const rows: HexDumpRow[] = [];
  const limit = Math.min(bytes.length, maxRows * 16);

  for (let i = 0; i < limit; i += 16) {
    const offset = i.toString(16).padStart(8, '0');
    const hexBytes: string[] = [];
    let ascii = '';

    for (let j = 0; j < 16; j++) {
      if (i + j < bytes.length) {
        const b = bytes[i + j];
        hexBytes.push(b.toString(16).padStart(2, '0'));
        // Printable ASCII range (32 - 126)
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
      } else {
        hexBytes.push('  ');
        ascii += ' ';
      }
    }

    rows.push({ offset, hexBytes, ascii });
  }

  return rows;
}

/**
 * Inspects initial magic bytes to identify binary container headers.
 */
export function inspectMagicHeader(bytes: Uint8Array): string {
  if (bytes.length >= 4) {
    // MBC magic: 'M' 'B' 'C' '\0' (0x4D, 0x42, 0x43, 0x00)
    if (bytes[0] === 0x4d && bytes[1] === 0x42 && bytes[2] === 0x43 && bytes[3] === 0x00) {
      const vMaj = bytes[4] ?? 1;
      const vMin = bytes[5] ?? 0;
      return `Manifest Portable Bytecode Container (Magic: MBC\\0, Version ${vMaj}.${vMin})`;
    }

    // WASM magic: '\0' 'a' 's' 'm' (0x00, 0x61, 0x73, 0x6D)
    if (bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d) {
      return `WebAssembly Binary Module (Magic: \\0asm, Version ${bytes[4] ?? 1})`;
    }

    // PNG: 0x89 0x50 0x4E 0x47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'Portable Network Graphics (PNG) Image';
    }

    // GIF: "GIF87a" or "GIF89a"
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'Graphics Interchange Format (GIF) Image';
    }

    // JPEG: 0xFF 0xD8 0xFF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'JPEG JFIF Image';
    }

    // ZIP: 0x50 0x4B 0x03 0x04
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return 'ZIP Archive / Container';
    }
  }

  return 'Generic Octet Stream / Unrecognized Header';
}
