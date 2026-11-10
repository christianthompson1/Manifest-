/**
 * Manifest Studio - Dedicated Asset Inspector
 *
 * Professional multi-format asset viewer supporting:
 * - Images (PNG, JPG, WebP, GIF, SVG): fit-to-screen, 1:1, zoom in/out (25%-500%), pan, dimensions, checkerboard.
 * - Audio & Video (MP3, WAV, OGG, MP4, WebM): native playback, volume, timeline, format badge.
 * - CSV: interactive table grid preview with column detection and row count.
 * - Markdown: live rendered preview with headings, code blocks, lists vs raw text.
 * - Binary & Compiled (.mbc, .wasm, .bin, .dat): 16-bytes-per-row hex dump, ASCII view, magic signature analyzer, and MVM/WASM execution triggers.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Play,
  FileCode,
  Table,
  Eye,
  Code,
  Cpu,
  Layers,
  Copy,
  Check,
  Music,
  Video as VideoIcon,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';
import {
  detectFileClassification,
  extractBytesFromContent,
  generateHexDump,
  inspectMagicHeader,
  FileClassification,
} from './file-signatures.ts';

interface AssetInspectorProps {
  fileName: string;
  filePath: string;
  content: string;
  mimeType?: string;
  isBinary?: boolean;
  onRun?: () => void;
  onOpenRawText?: () => void;
}

export const AssetInspector: React.FC<AssetInspectorProps> = ({
  fileName,
  filePath,
  content,
  mimeType,
  isBinary = false,
  onRun,
  onOpenRawText,
}) => {
  const classification = useMemo(
    () => detectFileClassification(filePath, mimeType, content),
    [filePath, mimeType, content]
  );

  // Image viewer state
  const [zoom, setZoom] = useState<number>(100);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [copiedHex, setCopiedHex] = useState(false);

  // Markdown view mode ('preview' | 'source')
  const [markdownTab, setMarkdownTab] = useState<'preview' | 'source'>('preview');

  // Object URL management for audio/video/binary previews
  const [mediaUrl, setMediaUrl] = useState<string>('');

  useEffect(() => {
    let url = '';
    if (content.startsWith('data:')) {
      url = content;
      setMediaUrl(url);
    } else if (classification.category === 'audio' || classification.category === 'video') {
      try {
        const bytes = extractBytesFromContent(content);
        const blob = new Blob([bytes as any], { type: classification.mimeType });
        url = URL.createObjectURL(blob);
        setMediaUrl(url);
      } catch (e) {
        console.warn('Failed to construct media blob URL:', e);
      }
    } else if (classification.category === 'image' && filePath.endsWith('.svg')) {
      // SVG text content
      const blob = new Blob([content], { type: 'image/svg+xml' });
      url = URL.createObjectURL(blob);
      setMediaUrl(url);
    }

    return () => {
      if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
  }, [content, filePath, classification.category, classification.mimeType]);

  // Decode binary bytes for hex dump & size computation
  const rawBytes = useMemo(() => {
    return extractBytesFromContent(content);
  }, [content]);

  const hexRows = useMemo(() => {
    if (classification.category === 'binary' || isBinary) {
      return generateHexDump(rawBytes, 256);
    }
    return [];
  }, [classification.category, isBinary, rawBytes]);

  const magicHeader = useMemo(() => {
    return inspectMagicHeader(rawBytes);
  }, [rawBytes]);

  // Handle image load metadata
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  const handleCopyHex = () => {
    const text = hexRows.map((r) => `${r.offset}  ${r.hexBytes.join(' ')}  |${r.ascii}|`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedHex(true);
    setTimeout(() => setCopiedHex(false), 2000);
  };

  // --------------------------------------------------------------------------
  // RENDER: Image Previewer
  // --------------------------------------------------------------------------
  if (classification.category === 'image') {
    const imgSrc = mediaUrl || content;
    return (
      <div className="w-full h-full flex flex-col bg-[#1f1f1f] text-[#cccccc] select-none">
        {/* Toolbar */}
        <div className="h-9 bg-[#181818] border-b border-[#2d2d2d] px-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-3.5 h-3.5 text-[#4ec9b0]" />
            <span className="font-semibold text-white">{fileName}</span>
            <span className="text-[11px] text-[#858585] font-mono">
              {classification.mimeType} &bull; {rawBytes.length.toLocaleString()} bytes
              {dimensions ? ` &bull; ${dimensions.width} × ${dimensions.height} px` : ''}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(25, z - 25))}
              className="p-1 rounded hover:bg-[#252526] text-[#858585] hover:text-white"
              title="Zoom Out (Min 25%)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-[#858585] w-12 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(500, z + 25))}
              className="p-1 rounded hover:bg-[#252526] text-[#858585] hover:text-white"
              title="Zoom In (Max 500%)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <div className="h-3 w-[1px] bg-[#2d2d2d] mx-1" />
            <button
              onClick={() => setZoom(100)}
              className="px-2 py-0.5 rounded text-[11px] bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc]"
              title="Original Size (1:1)"
            >
              1:1
            </button>
            <button
              onClick={() => setZoom(100)}
              className="p-1 rounded hover:bg-[#252526] text-[#858585] hover:text-white"
              title="Reset View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Canvas viewport with checkerboard pattern */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-8 bg-[#141414] relative">
          <div
            className="checkerboard-pattern border border-[#2d2d2d] rounded shadow-2xl p-2 transition-transform duration-100 ease-out flex items-center justify-center max-w-full max-h-full"
            style={{
              backgroundImage: `linear-gradient(45deg, #252526 25%, transparent 25%),
                                linear-gradient(-45deg, #252526 25%, transparent 25%),
                                linear-gradient(45deg, transparent 75%, #252526 75%),
                                linear-gradient(-45deg, transparent 75%, #252526 75%)`,
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
              backgroundColor: '#1a1a1a',
            }}
          >
            <img
              src={imgSrc}
              alt={fileName}
              onLoad={handleImageLoad}
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'center center',
                transition: 'transform 0.1s ease',
              }}
              className="max-h-[70vh] max-w-[80vw] object-contain select-none"
            />
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: Audio Player
  // --------------------------------------------------------------------------
  if (classification.category === 'audio') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#1f1f1f] text-[#cccccc] p-8 select-text">
        <div className="max-w-md w-full bg-[#181818] border border-[#2d2d2d] rounded-2xl p-6 space-y-4 text-center shadow-xl">
          <div className="w-14 h-14 rounded-full bg-[#252526] border border-[#2d2d2d] mx-auto flex items-center justify-center text-[#4ec9b0]">
            <Music className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{fileName}</h3>
            <p className="text-[11px] text-[#858585] font-mono mt-0.5">
              {classification.mimeType} &bull; {rawBytes.length.toLocaleString()} bytes
            </p>
          </div>
          <audio controls className="w-full mt-2" src={mediaUrl || content}>
            Your browser does not support audio playback.
          </audio>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: Video Player
  // --------------------------------------------------------------------------
  if (classification.category === 'video') {
    return (
      <div className="w-full h-full flex flex-col bg-[#1f1f1f] text-[#cccccc]">
        <div className="h-9 bg-[#181818] border-b border-[#2d2d2d] px-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <VideoIcon className="w-3.5 h-3.5 text-[#569cd6]" />
            <span className="font-semibold text-white">{fileName}</span>
            <span className="text-[11px] text-[#858585] font-mono">
              {classification.mimeType} &bull; {rawBytes.length.toLocaleString()} bytes
            </span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 bg-[#141414]">
          <video
            controls
            className="max-h-[75vh] max-w-[85vw] rounded border border-[#2d2d2d] shadow-2xl"
            src={mediaUrl || content}
          >
            Your browser does not support video playback.
          </video>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: CSV Interactive Table Previewer
  // --------------------------------------------------------------------------
  if (classification.category === 'csv') {
    const rows = content.trim().split('\n').map((line) => {
      // Basic CSV parser handling quotes
      const cells: string[] = [];
      let inQuotes = false;
      let curr = '';
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          cells.push(curr.trim());
          curr = '';
        } else {
          curr += c;
        }
      }
      cells.push(curr.trim());
      return cells;
    });

    const header = rows[0] || [];
    const dataRows = rows.slice(1);

    return (
      <div className="w-full h-full flex flex-col bg-[#1f1f1f] text-[#cccccc] select-text">
        <div className="h-9 bg-[#181818] border-b border-[#2d2d2d] px-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Table className="w-3.5 h-3.5 text-[#4ec9b0]" />
            <span className="font-semibold text-white">{fileName}</span>
            <span className="text-[11px] text-[#858585] font-mono">
              {rows.length} rows &bull; {header.length} columns &bull; {content.length} characters
            </span>
          </div>
          {onOpenRawText && (
            <button
              onClick={onOpenRawText}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc]"
            >
              <Code className="w-3 h-3" />
              <span>Edit as Text</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4 custom-scrollbar">
          <div className="inline-block min-w-full align-middle border border-[#2d2d2d] rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-[#2d2d2d] text-left text-xs font-mono">
              <thead className="bg-[#252526] text-[#ffffff] font-semibold sticky top-0">
                <tr>
                  <th className="py-2 px-3 border-r border-[#2d2d2d] w-12 text-center text-[#858585]">#</th>
                  {header.map((col, idx) => (
                    <th key={idx} className="py-2 px-3 border-r border-[#2d2d2d] last:border-r-0">
                      {col || `Col ${idx + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#252526] bg-[#1a1a1a]">
                {dataRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-[#222222]">
                    <td className="py-1.5 px-3 border-r border-[#2d2d2d] text-center text-[#666666] select-none bg-[#1e1e1e]">
                      {rIdx + 1}
                    </td>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-1.5 px-3 border-r border-[#252526] last:border-r-0 truncate max-w-xs">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: Markdown Previewer (Preview vs Raw Source)
  // --------------------------------------------------------------------------
  if (classification.category === 'markdown' && markdownTab === 'preview') {
    return (
      <div className="w-full h-full flex flex-col bg-[#1f1f1f] text-[#cccccc] select-text">
        <div className="h-9 bg-[#181818] border-b border-[#2d2d2d] px-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-[#569cd6]" />
            <span className="font-semibold text-white">{fileName}</span>
            <span className="text-[11px] text-[#858585] font-mono">Markdown Rendered Preview</span>
          </div>
          <div className="flex items-center gap-1 bg-[#252526] p-0.5 rounded border border-[#2d2d2d]">
            <button
              onClick={() => setMarkdownTab('preview')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                markdownTab === 'preview' ? 'bg-[#1f1f1f] text-white shadow' : 'text-[#858585] hover:text-white'
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => onOpenRawText?.()}
              className="px-2 py-0.5 rounded text-[11px] font-medium text-[#858585] hover:text-white transition"
            >
              Source
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-4 leading-relaxed font-sans text-sm text-[#d4d4d4]">
            {content.split('\n\n').map((block, bIdx) => {
              const trimmed = block.trim();
              if (trimmed.startsWith('# ')) {
                return (
                  <h1 key={bIdx} className="text-2xl font-bold text-white border-b border-[#2d2d2d] pb-2 pt-4">
                    {trimmed.slice(2)}
                  </h1>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h2 key={bIdx} className="text-xl font-semibold text-white border-b border-[#2d2d2d] pb-1.5 pt-3">
                    {trimmed.slice(3)}
                  </h2>
                );
              }
              if (trimmed.startsWith('### ')) {
                return (
                  <h3 key={bIdx} className="text-base font-semibold text-white pt-2">
                    {trimmed.slice(4)}
                  </h3>
                );
              }
              if (trimmed.startsWith('```')) {
                const lines = trimmed.split('\n');
                const lang = lines[0].slice(3).trim();
                const code = lines.slice(1, -1).join('\n');
                return (
                  <div key={bIdx} className="my-3 rounded-lg border border-[#2d2d2d] overflow-hidden bg-[#181818]">
                    {lang && (
                      <div className="bg-[#252526] px-3 py-1 text-[10px] uppercase font-mono text-[#858585] border-b border-[#2d2d2d]">
                        {lang}
                      </div>
                    )}
                    <pre className="p-3 text-xs font-mono text-[#ce9178] overflow-x-auto">{code}</pre>
                  </div>
                );
              }
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                const items = trimmed.split('\n').map((i) => i.replace(/^[-*]\s+/, ''));
                return (
                  <ul key={bIdx} className="list-disc list-inside space-y-1 text-[#cccccc]">
                    {items.map((item, iIdx) => (
                      <li key={iIdx}>{item}</li>
                    ))}
                  </ul>
                );
              }
              return (
                <p key={bIdx} className="text-[#cccccc]">
                  {trimmed}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: Binary & Compiled Hex Dump Inspector (.mbc, .wasm, .bin, .dat)
  // --------------------------------------------------------------------------
  const isMbc = fileName.endsWith('.mbc') || mimeType === 'application/x-manifest-bytecode';
  const isWasm = fileName.endsWith('.wasm') || mimeType === 'application/wasm';

  return (
    <div className="w-full h-full flex flex-col bg-[#1f1f1f] text-[#cccccc] select-text">
      {/* Top Bar Header */}
      <div className="h-10 bg-[#181818] border-b border-[#2d2d2d] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {isMbc ? (
            <Cpu className="w-4 h-4 text-[#4ec9b0]" />
          ) : isWasm ? (
            <Layers className="w-4 h-4 text-[#dea584]" />
          ) : (
            <FileCode className="w-4 h-4 text-[#569cd6]" />
          )}
          <div>
            <span className="font-semibold text-white">{fileName}</span>
            <span className="ml-2 text-[11px] text-[#858585] font-mono">
              {classification.formatName} &bull; {rawBytes.length.toLocaleString()} bytes
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyHex}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] transition cursor-pointer"
            title="Copy Hex Dump"
          >
            {copiedHex ? <Check className="w-3.5 h-3.5 text-[#4ec9b0]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedHex ? 'Copied' : 'Copy Hex'}</span>
          </button>

          {(isMbc || isWasm) && onRun && (
            <button
              onClick={onRun}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-medium transition cursor-pointer"
            >
              <Play className="w-3 h-3 fill-white" />
              <span>{isMbc ? 'Execute in Rust MVM' : 'Run WASM Module'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Signature & Container Card */}
      <div className="bg-[#181818] border-b border-[#2d2d2d] px-4 py-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[#858585] uppercase tracking-wider text-[10px] font-semibold">Header Signature:</span>
          <span className="font-mono text-[#4ec9b0] bg-[#1f1f1f] px-2 py-0.5 rounded border border-[#2d2d2d]">
            {magicHeader}
          </span>
        </div>
        <div className="text-[11px] text-[#858585]">
          Showing {hexRows.length * 16 > rawBytes.length ? rawBytes.length : hexRows.length * 16} / {rawBytes.length} bytes (16-byte aligned)
        </div>
      </div>

      {/* Hex Dump Table */}
      <div className="flex-1 overflow-auto p-4 custom-scrollbar font-mono text-xs leading-5 bg-[#141414]">
        <div className="min-w-fit space-y-0.5">
          {/* Header row */}
          <div className="flex items-center gap-4 text-[#666666] border-b border-[#2d2d2d] pb-1 mb-2 select-none">
            <span className="w-20">OFFSET</span>
            <span className="flex-1 min-w-[340px]">
              00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F
            </span>
            <span className="w-40">DECODED TEXT</span>
          </div>

          {hexRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-4 hover:bg-[#1f1f1f] px-1 py-0.5 rounded group">
              <span className="w-20 text-[#569cd6] group-hover:text-white select-none">{row.offset}</span>
              <div className="flex-1 min-w-[340px] flex items-center gap-1.5 text-[#ce9178]">
                <span className="font-mono">{row.hexBytes.slice(0, 8).join(' ')}</span>
                <span className="text-[#555555] font-mono"> </span>
                <span className="font-mono">{row.hexBytes.slice(8, 16).join(' ')}</span>
              </div>
              <span className="w-40 text-[#4ec9b0] font-mono whitespace-pre border-l border-[#2d2d2d] pl-3">
                {row.ascii}
              </span>
            </div>
          ))}

          {rawBytes.length > 4096 && (
            <div className="text-center py-4 text-[#858585] text-xs font-sans">
              ... Hex dump truncated after 4,096 bytes for smooth interactive performance. Total file size: {rawBytes.length.toLocaleString()} bytes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
