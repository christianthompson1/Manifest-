export interface ManifestValue {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  value: any;
}

export function toManifestValue(val: any): ManifestValue {
  if (val === null || val === undefined) return { type: 'null', value: null };
  if (typeof val === 'number') return { type: 'number', value: val };
  if (typeof val === 'string') return { type: 'string', value: val };
  if (typeof val === 'boolean') return { type: 'boolean', value: val };
  if (Array.isArray(val)) return { type: 'array', value: val };
  return { type: 'object', value: val };
}
