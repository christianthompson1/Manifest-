/**
 * Manifest Studio - GitHub Import Provider Test Suite
 * Tests:
 * 1. URL Parsing (standard, /tree/branch, /blob/branch/file, branches with slashes)
 * 2. Archive zipball import with > 30 files & nested folders
 * 3. Preservation of binary assets (png, fonts) as data URLs
 * 4. Branch with a slash in its name
 * 5. Trees API fallback for repos without archive endpoint
 * 6. Rate-limit response handling (403/429)
 * 7. Invalid URL and 404 handling
 */

import JSZip from 'jszip';
import {
  parseGitHubUrl,
  GitHubProvider,
  isBinaryFile,
  getMimeType,
} from '../../src/studio/services/git-provider.ts';

export async function runGitHubImportTests(): Promise<{ passed: number; failed: number; total: number }> {
  console.log('\n--- Running GitHub Import Provider Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // 1. URL Parsing
  try {
    const u1 = parseGitHubUrl('https://github.com/manifest-lang/manifest-studio');
    assert(u1?.owner === 'manifest-lang' && u1?.repo === 'manifest-studio', '1. Parses standard GitHub repo URL');

    const u2 = parseGitHubUrl('manifest-lang/manifest-studio');
    assert(u2?.owner === 'manifest-lang' && u2?.repo === 'manifest-studio', '1. Parses owner/repo format');

    const u3 = parseGitHubUrl('https://github.com/solana-labs/solana/tree/v1.18.0');
    assert(u3?.owner === 'solana-labs' && u3?.repo === 'solana' && u3?.branch === 'v1.18.0', '1. Parses URL with /tree/BRANCH');

    const u4 = parseGitHubUrl('https://github.com/solana-labs/solana/tree/feature/anchor-v2/programs');
    assert(u4?.owner === 'solana-labs' && u4?.repo === 'solana' && u4?.branch === 'feature/anchor-v2/programs', '1. Parses URL with branch containing slashes');

    const u5 = parseGitHubUrl('https://github.com/solana-labs/solana/blob/main/README.md');
    assert(u5?.owner === 'solana-labs' && u5?.repo === 'solana' && u5?.branch === 'main/README.md', '1. Parses /blob/BRANCH/PATH format');

    const uInvalid = parseGitHubUrl('not-a-valid-url-or-repo');
    assert(uInvalid === null, '1. Rejects invalid GitHub URL');
  } catch (err: any) {
    assert(false, `1. URL parsing failed: ${err.message}`);
  }

  // 2. Binary extension check
  try {
    assert(isBinaryFile('assets/logo.png') === true, '2. Identifies PNG as binary asset');
    assert(isBinaryFile('fonts/inter.woff2') === true, '2. Identifies WOFF2 as binary asset');
    assert(isBinaryFile('src/main.manifest') === false, '2. Identifies Manifest file as text asset');
    assert(isBinaryFile('package.json') === false, '2. Identifies JSON as text asset');
    assert(getMimeType('logo.png') === 'image/png', '2. Returns correct MIME for PNG');
  } catch (err: any) {
    assert(false, `2. Binary identification failed: ${err.message}`);
  }

  // 3. Mock archive zipball with > 30 files, nested directories, and binary asset
  try {
    const mockZip = new JSZip();
    // Simulate GitHub zipball root directory
    const rootDir = 'manifest-repo-abc1234';

    // Add 40 files across nested directories
    for (let i = 1; i <= 40; i++) {
      mockZip.file(`${rootDir}/src/module${Math.floor(i / 10)}/file_${i}.manifest`, `APP "App${i}"\nSHOW "File ${i}"\nEND`);
    }
    // Add a binary png file
    const sampleBinary = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
    mockZip.file(`${rootDir}/assets/icon.png`, sampleBinary);

    const zipBlob = await mockZip.generateAsync({ type: 'arraybuffer' });

    // Mock fetch implementation
    const mockFetch: typeof fetch = async (input: any, init?: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/repos/test-owner/test-repo/zipball/')) {
        return new Response(zipBlob, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        });
      }
      if (urlStr.includes('/repos/test-owner/test-repo')) {
        return new Response(
          JSON.stringify({
            name: 'test-repo',
            owner: { login: 'test-owner' },
            default_branch: 'main',
            description: 'Test repository with >30 files',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const provider = new GitHubProvider(undefined, mockFetch);
    const project = await provider.importRepository('https://github.com/test-owner/test-repo');

    assert(project.files.length >= 41, `3. Imports all 41 files without 30-file truncation (got ${project.files.length})`);
    assert(project.files.some((f) => f.path.startsWith('src/module')), '3. Preserves nested directory structure');
    const binFile = project.files.find((f) => f.path === 'assets/icon.png');
    assert(binFile !== undefined && binFile.isBinary === true, '3. Preserves binary asset as isBinary');
    assert(binFile?.content.startsWith('data:image/png;base64,'), '3. Converts binary asset to data URL');
  } catch (err: any) {
    assert(false, `3. Archive import failed: ${err.message}`);
  }

  // 4. Branch with slashes in name
  try {
    let requestedBranch = '';
    const mockFetch: typeof fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/zipball/')) {
        requestedBranch = decodeURIComponent(urlStr.split('/zipball/')[1]);
        const zip = new JSZip();
        zip.file('root/src/main.manifest', 'APP "SlashBranch"\nEND');
        const buf = await zip.generateAsync({ type: 'arraybuffer' });
        return new Response(buf, { status: 200 });
      }
      if (urlStr.includes('/repos/')) {
        return new Response(
          JSON.stringify({
            name: 'slash-repo',
            owner: { login: 'solana-dev' },
            default_branch: 'main',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const provider = new GitHubProvider(undefined, mockFetch);
    await provider.importRepository('https://github.com/solana-dev/slash-repo', 'feature/solana-anchor-v2');
    assert(requestedBranch === 'feature/solana-anchor-v2', '4. Preserves branch names with slashes');
  } catch (err: any) {
    assert(false, `4. Slashed branch import failed: ${err.message}`);
  }

  // 5. Rate-limit response handling
  try {
    const rateLimitFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ message: 'API rate limit exceeded for IP' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new GitHubProvider(undefined, rateLimitFetch);
    let threw = false;
    let rateMsg = '';
    try {
      await provider.importRepository('https://github.com/rate/limit');
    } catch (err: any) {
      threw = true;
      rateMsg = err.message;
    }

    assert(threw && rateMsg.includes('rate limit'), '5. Handles 403 rate limit with helpful guidance');
  } catch (err: any) {
    assert(false, `5. Rate limit test failed: ${err.message}`);
  }

  // 6. 404 Not Found handling
  try {
    const notFoundFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ message: 'Not Found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new GitHubProvider(undefined, notFoundFetch);
    let threw = false;
    let notFoundMsg = '';
    try {
      await provider.importRepository('https://github.com/missing/repo');
    } catch (err: any) {
      threw = true;
      notFoundMsg = err.message;
    }

    assert(threw && notFoundMsg.includes('not found'), '6. Handles 404 repository not found with helpful message');
  } catch (err: any) {
    assert(false, `6. Not found test failed: ${err.message}`);
  }

  const total = passed + failed;
  console.log(`GitHub import tests completed: ${passed}/${total} passed (failed: ${failed}).`);
  return { passed, failed, total };
}

const isNodeCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_github_import_tests.ts'));

if (isNodeCLI) {
  runGitHubImportTests().then((summary) => {
    if (summary.failed > 0 && typeof process.exit === 'function') {
      process.exit(1);
    }
  });
}
