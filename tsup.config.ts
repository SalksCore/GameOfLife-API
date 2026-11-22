import { defineConfig } from 'tsup';

export default defineConfig({
  // create-admin : création du premier compte admin sur le serveur (node dist/create-admin.js)
  entry: { index: 'src/index.ts', 'create-admin': 'scripts/create-admin.ts' },
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  minify: false,
});
