const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
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
