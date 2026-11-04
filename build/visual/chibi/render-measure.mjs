/* Elsewhere Portal — M4.06 closure: count heads-tall in the rendered
   frames render-measure.py produces. PNG decoding without new
   dependencies: this script shells to python3 + PIL, which the
   factory pipeline already depends on (transcode_images.py,
   finish_standees.py). The counting rule lives here and is what the
   record cites:
     span = rows whose alpha coverage exceeds 0.5% of the frame width
     headsTall = fullSpan / headSpan   (same camera, same frame size)
   Usage: node render-measure.mjs <slug> [slug...]
   Writes/appends build/visual/chibi/rendered-measure.json. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
function spanOf(path) {
  const code = `
from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert('RGBA')
w, h = im.size
a = im.getchannel('A').load()
rows = [y for y in range(h) if sum(1 for x in range(w) if a[x, y] > 8) > w * 0.005]
print(f"{min(rows)} {max(rows)} {max(rows) - min(rows) + 1}" if rows else "EMPTY")
`;
  const out = execFileSync('python3', ['-c', code, path], { encoding: 'utf8' }).trim();
  if (out === 'EMPTY') throw new Error(`render has no visible figure: ${path}`);
  const [top, bottom, span] = out.split(' ').map(Number);
  return { top, bottom, spanPx: span };
}

const slugs = process.argv.slice(2);
if (!slugs.length) { console.error('usage: node render-measure.mjs <slug> [slug...]'); process.exit(2); }
const recordPath = new URL('./rendered-measure.json', import.meta.url).pathname;
const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : {
  schema: 'portal.rendered-measure/v1',
  method: 'Blender Workbench renders of the factory masters (outputs-v2/<slug>.glb) in REST pose (armature pose_position=REST, no action — the pose the accessor gate measures; clearing actions alone leaves the importer pose in place and measurably pitches the head). Two orthographic cameras: canonical = elevation 35 from the south (the scene camera), plate = elevation 0 head-on. Two passes per camera: whole figure, and the head mesh alone (the GLB node named "head" — exactly what measure-figure.mjs counts). Spans from the alpha channel: rows with coverage > 0.5% of frame width; headsTall = fullSpanPx / headSpanPx in the same frame. Renders in ./renders/.',
  gate: 'M4.06 exit gate: 2-2.5 heads tall in a rendered frame (PLAN-TO-COMPLETE M4.06). The Bible production band [0.40, 0.43] head share derives [2.33, 2.50] heads. The plate frame is the proportion measure; the canonical street view foreshortens the body while the round head keeps its silhouette, so its count reads lower by projection, not by proportion — recorded, not hidden.',
  figures: {},
};
for (const slug of slugs) {
  const entry = { kit: slug, cameras: {} };
  for (const cam of ['canonical', 'plate']) {
    const full = spanOf(new URL(`./renders/${slug}--${cam}-full.png`, import.meta.url).pathname);
    const head = spanOf(new URL(`./renders/${slug}--${cam}-head.png`, import.meta.url).pathname);
    entry.cameras[cam] = {
      fullSpanPx: full.spanPx, headSpanPx: head.spanPx,
      headsTall: +(full.spanPx / head.spanPx).toFixed(3),
      headShare: +(head.spanPx / full.spanPx).toFixed(3),
    };
  }
  record.figures[slug] = entry;
  console.log(`${slug}: canonical ${entry.cameras.canonical.headsTall} heads (share ${entry.cameras.canonical.headShare}); plate ${entry.cameras.plate.headsTall} heads (share ${entry.cameras.plate.headShare})`);
}
writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(`record: ${recordPath}`);
