/**
 * Manifest Studio - Security Escaping & SVG Sanitization Helpers
 * Centralizes context-appropriate HTML, comment, JS string, and SVG preview safety checks.
 */

export const MAX_SVG_PREVIEW_BYTES = 2 * 1024 * 1024; // 2 MiB preview bound

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Neutralizes sequences that could terminate or break out of an HTML comment (`<!-- ... -->`).
 */
export function sanitizeHtmlCommentText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/--+/g, (dashes) => dashes.split('').join(' '))
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes closing `</script` and HTML comment opens (`<!--`) inside inline `<script>` bodies
 * while preserving normal JavaScript operators, strings, and Unicode text.
 */
export function escapeInlineJsForScriptTag(js: string): string {
  return String(js)
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(/<!--/g, '<\\!--');
}

/**
 * Safely serializes a string for interpolation into an inline JS expression inside HTML.
 */
export function escapeJsStringLiteral(value: string): string {
  return JSON.stringify(String(value))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function isSafeImageDataUrl(url: string): boolean {
  const trimmed = (url || '').trim();
  return /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;charset=[^;,]+)?;base64,[a-zA-Z0-9+/=\s]+$/i.test(
    trimmed
  ) || /^data:image\/svg\+xml(?:;charset=[^,]+)?,/i.test(trimmed);
}

export interface SvgValidationResult {
  valid: boolean;
  reason?: string;
  cleanSvgText?: string;
}

function decodeSvgDataUrl(raw: string): string | null {
  const match = raw.match(/^data:image\/svg\+xml([^,]*),(.*)$/is);
  if (!match) return null;
  const meta = match[1].toLowerCase();
  const payload = match[2];
  try {
    if (meta.includes(';base64')) {
      const b64 = payload.replace(/\s+/g, '');
      if (typeof atob === 'function') {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      }
      return Buffer.from(b64, 'base64').toString('utf-8');
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

export function isSvgAsset(file: { path: string; mimeType?: string; content: string }): boolean {
  if (file.path.toLowerCase().endsWith('.svg')) return true;
  if ((file.mimeType || '').toLowerCase() === 'image/svg+xml') return true;
  const trimmed = (file.content || '').trimStart().toLowerCase();
  return trimmed.startsWith('data:image/svg+xml') || /^<\?xml[\s\S]*?<svg\b|<svg\b/i.test(trimmed);
}

/**
 * Validates that raw SVG text (or SVG data URL) is genuinely bounded XML SVG
 * and strips active script/event-handler constructs prior to Blob URL `<img>` rendering.
 */
export function validateSvgPreviewContent(
  content: string,
  maxBytes: number = MAX_SVG_PREVIEW_BYTES
): SvgValidationResult {
  if (!content || typeof content !== 'string') {
    return { valid: false, reason: 'Empty SVG content.' };
  }

  let svgText = content.replace(/^\uFEFF/, '').trim();
  if (svgText.toLowerCase().startsWith('data:image/svg+xml')) {
    const decoded = decodeSvgDataUrl(svgText);
    if (!decoded) {
      return { valid: false, reason: 'Malformed SVG data URL.' };
    }
    svgText = decoded.replace(/^\uFEFF/, '').trim();
  } else if (svgText.toLowerCase().startsWith('data:')) {
    return { valid: false, reason: 'Unsupported non-SVG data URL for SVG asset.' };
  }

  const byteLength = new TextEncoder().encode(svgText).byteLength;
  if (byteLength === 0) {
    return { valid: false, reason: 'Empty SVG markup.' };
  }
  if (byteLength > maxBytes) {
    return { valid: false, reason: `SVG exceeds preview size limit (${maxBytes} bytes).` };
  }

  // Reject XML entity declarations / DOCTYPE bombs and non-SVG HTML documents
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(svgText)) {
    return { valid: false, reason: 'SVG DOCTYPE/ENTITY declarations are disallowed.' };
  }

  // Strip leading XML declaration and XML comments before checking root element
  const withoutProlog = svgText
    .replace(/^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->)*/i, '')
    .trimStart();

  if (!/^<svg(?:\s|>|\/)/i.test(withoutProlog) || !/<\/svg\s*>/i.test(withoutProlog) && !/^<svg[^>]*\/\s*>$/i.test(withoutProlog)) {
    return { valid: false, reason: 'Content does not have a valid <svg> root element.' };
  }

  // Defense-in-depth scrubbing even though preview always mounts inside isolated <img> Blob URL
  const sanitized = svgText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');

  return {
    valid: true,
    cleanSvgText: sanitized,
  };
}
