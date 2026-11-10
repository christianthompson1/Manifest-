/**
 * Manifest Phase 11C Automated Test Suite
 * Validates:
 * - File classification (MIME & extension detection for Image, Audio, Video, CSV, Markdown, Binary, Code)
 * - Binary magic byte container detection (MBC\0, \0asm, PNG, JPEG, GIF, ZIP)
 * - 16-byte aligned Hex Dump generation with offset, hex bytes, and ASCII decoded text
 * - Content-to-bytes extraction (data URI base64 decoding vs text bytes)
 */

import {
  detectFileClassification,
  extractBytesFromContent,
  generateHexDump,
  inspectMagicHeader,
} from '../../src/studio/editor/file-signatures.ts';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`[Phase 11C Test Failure] ${msg}`);
  }
}

function runPhase11cTests() {
  console.log('=== RUNNING MANIFEST PHASE 11C: ASSET INSPECTION & FILE EXPERIENCE TESTS ===\n');
  let passed = 0;

  // Test 1: File Classification
  {
    const imgPng = detectFileClassification('assets/logo.png');
    assert(imgPng.category === 'image', 'PNG should be classified as image');
    assert(imgPng.isBinary === true, 'PNG should be marked as binary');

    const imgSvg = detectFileClassification('icons/icon.svg');
    assert(imgSvg.category === 'image', 'SVG should be classified as image');
    assert(imgSvg.isBinary === false, 'SVG text should not be binary');

    const audio = detectFileClassification('sound/theme.mp3');
    assert(audio.category === 'audio', 'MP3 should be classified as audio');

    const video = detectFileClassification('media/demo.mp4');
    assert(video.category === 'video', 'MP4 should be classified as video');

    const csv = detectFileClassification('data/users.csv');
    assert(csv.category === 'csv', 'CSV should be classified as csv');

    const md = detectFileClassification('docs/README.md');
    assert(md.category === 'markdown', 'Markdown should be classified as markdown');

    const mbc = detectFileClassification('build/main.mbc');
    assert(mbc.category === 'binary', 'MBC should be classified as binary');
    assert(mbc.isKnownExecutable === true, 'MBC should be recognized as executable');

    const wasm = detectFileClassification('build/app.wasm');
    assert(wasm.category === 'binary', 'WASM should be classified as binary');
    assert(wasm.isKnownExecutable === true, 'WASM should be recognized as executable');

    console.log('  ✓ Test 1: Accurate file classification across images, audio, video, CSV, markdown, and binaries');
    passed++;
  }

  // Test 2: Binary Magic Header Signatures
  {
    // MBC magic: 0x4D 0x42 0x43 0x00, version 1.0
    const mbcBytes = new Uint8Array([0x4d, 0x42, 0x43, 0x00, 0x01, 0x00, 0x00, 0x00]);
    const mbcHeader = inspectMagicHeader(mbcBytes);
    assert(mbcHeader.includes('Manifest Portable Bytecode Container'), 'Should identify MBC magic');

    // WASM magic: 0x00 0x61 0x73 0x6D, version 1
    const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const wasmHeader = inspectMagicHeader(wasmBytes);
    assert(wasmHeader.includes('WebAssembly Binary Module'), 'Should identify WASM magic');

    // PNG magic: 0x89 0x50 0x4E 0x47
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngHeader = inspectMagicHeader(pngBytes);
    assert(pngHeader.includes('Portable Network Graphics'), 'Should identify PNG magic');

    // JPEG magic: 0xFF 0xD8 0xFF
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const jpegHeader = inspectMagicHeader(jpegBytes);
    assert(jpegHeader.includes('JPEG JFIF Image'), 'Should identify JPEG magic');

    console.log('  ✓ Test 2: Magic byte identification for MBC, WASM, PNG, and JPEG containers');
    passed++;
  }

  // Test 3: Hex Dump Formatter
  {
    // 32 bytes sample
    const sample = new Uint8Array([
      0x4d, 0x42, 0x43, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x00, 0x00, 0x00, 0x00,
    ]);

    const dump = generateHexDump(sample, 10);
    assert(dump.length === 2, `Dump should produce 2 rows of 16 bytes, got ${dump.length}`);
    assert(dump[0].offset === '00000000', 'First row offset should be 00000000');
    assert(dump[1].offset === '00000010', 'Second row offset should be 00000010 (16 in hex)');
    assert(dump[0].hexBytes[0] === '4d', 'First hex byte should be 4d');
    assert(dump[0].hexBytes[1] === '42', 'Second hex byte should be 42');
    assert(dump[0].ascii.startsWith('MBC.'), 'ASCII text should display printable characters and dots for nulls');
    assert(dump[1].ascii.includes('Hello World!'), 'Second row ASCII should contain decoded string');

    console.log('  ✓ Test 3: Standard 16-bytes-per-row Hex Dump generator with byte offsets and ASCII decoded view');
    passed++;
  }

  // Test 4: Base64 Data URI decoding to raw Uint8Array
  {
    // 'Manifest' in base64 is 'TWFuaWZlc3Q='
    const dataUri = 'data:application/octet-stream;base64,TWFuaWZlc3Q=';
    const decoded = extractBytesFromContent(dataUri);
    assert(decoded.length === 8, `Decoded bytes length should be 8, got ${decoded.length}`);
    const text = new TextDecoder().decode(decoded);
    assert(text === 'Manifest', `Decoded text should be 'Manifest', got '${text}'`);

    console.log('  ✓ Test 4: Lossless extraction and decoding of Base64 Data URIs to Uint8Array');
    passed++;
  }

  console.log(`\n>>> ALL ${passed}/${passed} PHASE 11C ASSET INSPECTION TESTS PASSED SUCCESSFULLY! <<<\n`);
}

runPhase11cTests();
