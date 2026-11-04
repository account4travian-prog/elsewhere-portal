// Node module-resolution hook for the scene tests (registered by
// figure-loader.test.mjs before it imports the loader wiring).
//
// The vendored three addons in ../vendor (GLTFLoader.js and its utils)
// import the bare specifier 'three', which a browser resolves through
// scene.html's importmap. Node has no importmap; this hook maps the
// same specifier to the scene's own vendored three.module.js, so the
// tests exercise the scene's actual vendored copies — not a package
// from anywhere else.
const THREE_URL = new URL('../vendor/three.module.js', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
  return next(specifier, context);
}
