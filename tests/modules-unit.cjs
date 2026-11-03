const {spawnSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const result=spawnSync(process.execPath,['--test','tests/business.test.js','tests/cloud.test.js','tests/financeiro.test.js','tests/teams.test.js','tests/migration-financas.test.js'],{cwd:root,stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exit(result.status === 0 ? 0 : result.status || 1);
