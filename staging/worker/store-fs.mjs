// Elsewhere Portal — staging Worker, filesystem store shim.
//
// Implements the handler's store interface over the publisher's local
// bucket directory, with the same semantics as the R2 binding: keys are
// opaque names ("publish-manifest.json", "objects/<sha256>"), a miss
// is null, and bytes come back exactly as written. This is what lets
// the identical Worker handler run locally (serve-local.mjs) and in
// tests against the publisher's real output.

import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

export function createFsStore(bucketDir) {
  const root = normalize(bucketDir);
  return {
    async get(key) {
      // Keys are produced by the publisher and the handler only; still,
      // never let a key escape the bucket directory.
      const path = normalize(join(root, key));
      if (!path.startsWith(root)) return null;
      try {
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
  };
}
