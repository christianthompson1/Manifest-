/**
 * Lightweight, zero-dependency Semantic Version (SemVer 2.0.0) parser and comparator
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export function parseSemVer(versionStr: string): SemVer | null {
  const clean = versionStr.trim().replace(/^[v=]/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  return 0;
}

/**
 * Checks whether concrete version satisfies constraint string.
 * Supports:
 * - exact: "1.2.3"
 * - caret: "^1.2.0" (compatible with 1.x.x >= 1.2.0)
 * - tilde: "~1.2.0" (compatible with 1.2.x >= 1.2.0)
 * - wildcard: "*"
 * - inequality: ">=1.0.0", "<2.0.0"
 */
export function satisfiesSemVer(versionStr: string, constraintStr: string): boolean {
  const v = parseSemVer(versionStr);
  if (!v) return false;

  const rawConstraint = constraintStr.trim();
  if (rawConstraint === '*' || rawConstraint === '') return true;

  // Caret ^1.2.3
  if (rawConstraint.startsWith('^')) {
    const target = parseSemVer(rawConstraint.slice(1));
    if (!target) return false;
    if (v.major !== target.major) return false;
    return compareSemVer(v, target) >= 0;
  }

  // Tilde ~1.2.3
  if (rawConstraint.startsWith('~')) {
    const target = parseSemVer(rawConstraint.slice(1));
    if (!target) return false;
    if (v.major !== target.major || v.minor !== target.minor) return false;
    return compareSemVer(v, target) >= 0;
  }

  // Greater than or equal >=1.0.0
  if (rawConstraint.startsWith('>=')) {
    const target = parseSemVer(rawConstraint.slice(2));
    if (!target) return false;
    return compareSemVer(v, target) >= 0;
  }

  // Less than <2.0.0
  if (rawConstraint.startsWith('<')) {
    const target = parseSemVer(rawConstraint.slice(1));
    if (!target) return false;
    return compareSemVer(v, target) < 0;
  }

  // Exact version
  const exactTarget = parseSemVer(rawConstraint);
  if (!exactTarget) return false;
  return compareSemVer(v, exactTarget) === 0;
}
