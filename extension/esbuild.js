const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const treeSitterAssets = [
  ['web-tree-sitter', 'web-tree-sitter.wasm'],
  ['tree-sitter-ruby', 'tree-sitter-ruby.wasm'],
  ['tree-sitter-html', 'tree-sitter-html.wasm'],
  ['tree-sitter-javascript', 'tree-sitter-javascript.wasm'],
  ['tree-sitter-typescript', 'tree-sitter-typescript.wasm'],
  ['tree-sitter-embedded-template', 'tree-sitter-embedded_template.wasm'],
];

function packageRoot(packageName) {
  let current = path.dirname(require.resolve(packageName, {
    paths: [__dirname],
  }));

  while (current !== path.dirname(current)) {
    const manifest = path.join(current, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === packageName) {
          return current;
        }
      } catch {
        // Continue walking upward.
      }
    }
    current = path.dirname(current);
  }

  throw new Error(`Unable to locate package root for ${packageName}`);
}

function copyTreeSitterAssets() {
  const destinationDir = path.join(__dirname, 'out', 'tree-sitter');
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const [packageName, wasmFile] of treeSitterAssets) {
    const source = path.join(packageRoot(packageName), wasmFile);
    const destination = path.join(destinationDir, wasmFile);
    fs.copyFileSync(source, destination);
  }
}

async function main() {
  copyTreeSitterAssets();

  // Force the CommonJS build of web-tree-sitter. The default ESM entry uses
  // `createRequire(import.meta.url)`, which esbuild lowers to an empty
  // `import.meta` object when bundling to CJS, so `import.meta.url` becomes
  // undefined and the runtime throws "argument 'filename' must be a file URL"
  // on init. The .cjs build relies on __filename and avoids this.
  const treeSitterCjs = path.join(packageRoot('web-tree-sitter'), 'web-tree-sitter.cjs');

  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    alias: {
      'web-tree-sitter': treeSitterCjs,
    },
    external: [
      'vscode',
      // Externalize large Node.js built-ins that don't need bundling
      'typescript',
    ],
    logLevel: 'info',
    // Optimization options
    treeShaking: true,
    metafile: production, // Generate bundle analysis in production
    // Remove console.log in production
    pure: production ? ['console.log'] : [],
    drop: production ? ['debugger'] : [],
    // Target modern Node.js for better optimization
    target: 'node16',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });

  if (watch) {
    await ctx.watch();
  } else {
    const result = await ctx.rebuild();

    // Log bundle analysis in production
    if (production && result.metafile) {
      console.log('\n📊 Bundle Analysis:');
      const analysis = await esbuild.analyzeMetafile(result.metafile, {
        verbose: false,
      });
      console.log(analysis);
    }

    await ctx.dispose();
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
