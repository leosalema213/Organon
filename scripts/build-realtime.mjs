// Bundle the pinned official client for the main process; never ship node_modules or tokens.
import { build } from 'vite';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({configFile:false,logLevel:'warn',build:{ssr:true,target:'node24',outDir:path.join(root,'electron/vendor'),emptyOutDir:false,minify:true,
 rolldownOptions:{input:{supabase:path.join(root,'electron/realtime-entry.mjs'),'resource-model':path.join(root,'electron/resource-model-entry.mjs')},output:{format:'cjs',entryFileNames:'[name].cjs',chunkFileNames:'chunks/[name]-[hash].cjs'}}},ssr:{noExternal:true}});
await fs.copyFile(path.join(root,'assets/licenses/supabase-js-LICENSE.txt'),path.join(root,'electron/vendor/supabase-LICENSE'));
console.log('Cliente Realtime empacotado para o processo principal.');
