import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// Lossless compression keeps the original 130 MiB avatar intact while reducing
// its transfer size. Browsers decode gzip before passing the GLB to Three.js.
// The file is streamed without Content-Length: Cloud Run caps HTTP/1 responses
// at 32 MiB unless they use chunked transfer encoding, and this one is ~52 MiB.
export function avatarRoute(assetRoot, assetName = 'alya.glb.gz') {
  const file = resolve(assetRoot, 'avatars/alya', assetName);
  return async (req, res, next) => {
    try {
      const { mtime } = await stat(file);
      res.set({
        'Content-Type': 'model/gltf-binary',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'public, max-age=86400',
        'Last-Modified': mtime.toUTCString(),
        Vary: 'Accept-Encoding',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch (error) {
      if (error.code === 'ENOENT') res.status(404).end();
      else next(error);
    }
  };
}
