import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// Lossless compression keeps the supplied ALYA model (a 27.7 MiB GLB, #61)
// intact while reducing its transfer size to about 21 MiB (22,085,850 bytes).
// Browsers decode gzip before passing the GLB to Three.js. The file is streamed
// without Content-Length (chunked transfer encoding): Cloud Run caps HTTP/1
// responses that are not chunked at 32 MiB, so a larger model keeps working.
export function avatarRoute(assetRoot) {
  const file = resolve(assetRoot, 'avatars/alya/alya.glb.gz');
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
