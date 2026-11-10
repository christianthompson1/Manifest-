# Manifest Studio Asset Management & File Inspection (Phase 11C)

Manifest Studio includes a professional asset inspection and project exploration experience designed for modern full-stack web and systems programming.

## Supported Asset Viewers

1. **Dedicated Image Previewer**:
   - Supported formats: PNG, JPEG, WebP, GIF, SVG (sanitized).
   - Features: Fit-to-screen, 1:1 original size, zoom controls (25% to 500%), transparent checkerboard background, natural image dimensions (`W × H` px), MIME type, and exact byte size.

2. **Audio & Video Players**:
   - Supported audio: MP3, WAV, OGG, M4A, FLAC.
   - Supported video: MP4, WebM, OGV.
   - Native controls with playback, timeline scrubbing, volume adjustment, and safe blob URL lifecycle management.

3. **CSV Interactive Table**:
   - Structured tabular view for comma-separated datasets.
   - Column header detection, row indexing, cell clipping, and toggle to edit raw text.

4. **Markdown Document Viewer**:
   - Live rendered view with headings, styled paragraphs, lists, and syntax-highlighted code blocks.
   - Dual-tab toggle (`Preview` vs `Source`).

5. **Binary & Hex Dump Inspector**:
   - Standard 16-byte aligned hex view: `OFFSET | HEX BYTES | ASCII`.
   - Magic header signature analyzer:
     - `MBC\0`: Manifest Portable Bytecode v1.0
     - `\0asm`: WebAssembly Binary Module
     - `PNG`: Portable Network Graphics
     - `JFIF`: JPEG Image
     - `GIF87a / GIF89a`: GIF Image
     - `PK\x03\x04`: ZIP Archive
   - Direct execution triggers for `.mbc` (Rust MVM) and `.wasm` modules.
   - Copy hex dump button for clipboard export.

## Project Explorer Enhancements

- **File Classification**: Real-time detection by extension and MIME signatures.
- **Visual Badges**: Generated compiler artifacts in `build/` (e.g., `build/main.mbc`, `build/app.wasm`) receive dedicated `artifact` badges.
- **File Management**:
  - New File / New Folder with inline naming.
  - Rename with workspace reference updating.
  - Duplicate File with auto-incrementing naming (`_copy.ext`).
  - Delete with safety confirmation dialog.
  - Search/filter across folders with auto-expansion of matched nodes.
