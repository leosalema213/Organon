# Plataforma de plugins próprios — Financeiro e MEI

Estado: implementação local preparada em 03/11/2026. Integração do shell,
publicação dos assets e execução dos testes ainda pendentes. Não houve build,
download real, alteração de versão, publicação ou migração de dados nesta tarefa.

## Inventário funcional

O aplicativo de origem fornece os domínios Financeiro e MEI; a distribuição de
plugins é um requisito novo do Organon, sem mecanismo equivalente a portar.
O inventário de operações/cálculos da origem pertence aos documentos
`FINANCEIRO.md` e `MEI.md` e aos respectivos chats de domínio.

A plataforma implementa:

- Preferências → Plugins: consultar catálogo, baixar/instalar, atualizar,
  recuperar versão anterior e remover; descrição/versões/erros em português.
- Navegação inicialmente vazia, refletindo instalações locais verificadas.
- Carregamento de página somente quando aberta; as páginas não entram no bundle
  inicial e não são importadas estaticamente pelo loader.
- Reuso da instância React/ReactDOM/JSX runtime e de Modal, PopupMenu e
  RichTextField do Organon; CSS do adicional é anexado ao abrir e removido ao sair.
- Instalação atômica por registro local, recuperação de uma versão anterior,
  preservação de dados e funcionamento dos pacotes já instalados sem rede.
- Catálogo exclusivamente próprio, assinatura Ed25519, sequência crescente,
  expiração para novos downloads, limites de bytes/tempo/redirecionamento,
  manifesto/ABI/faixa do host e SHA-256 por pacote e por arquivo.

## Arquivos e propriedade

| Arquivo | Responsabilidade |
| --- | --- |
| `electron/plugins.cjs` | Catálogo, instalação local, protocolo, verificação e registro IPC. |
| `src/plugin-system/runtime.js` | ABI compartilhado, import dinâmico e estilos. |
| `src/plugin-system/PluginPage.jsx` | Página lazy com recuperação de erro de import/render. |
| `src/plugin-system/PluginSettings.jsx` | Interface embutida nas Preferências e confirmação de remoção. |
| `src/plugin-system/usePlugins.js` | Lista local e eventos para navegação do shell. |
| `src/plugin-system/plugins.css` | Layout escopado usando os componentes/paleta existentes. |
| `scripts/plugins-build.mjs` | Gera separadamente os dois pacotes, sem carregar o build global. |
| `scripts/plugins-catalog.cjs` | Verifica pacotes e assina catálogo no ambiente de publicação. |
| `plugins/` | Documentação e diretório de saída ignorado pelo Git. |
| `tests/plugins.test.js` | Testes focados, sintéticos, sem rede ou build. |

Os fontes `src/plugins/financeiro/` e `src/plugins/mei/` continuam de propriedade
dos chats de domínio. Não foram editados aqui. Os arquivos globais de integração
continuam de propriedade do coordenador.

## Contrato de pacote/ABI

Cada página exporta `default function Page({api,user,workspace})`. `api` é o
transporte fechado de domínio definido no contrato do lote; `user` contém somente
identidade pública e `workspace` é `{id,name,owner_id}` ou null. O pacote visual
não recebe cloud, credenciais, tokens, fs, IPC genérico ou chaves administrativas.

O compilador aceita os imports normais `react`, `react-dom`,
`react/jsx-runtime` e imports relativos dos três componentes compartilhados.
Eles viram referências ao objeto congelado
`globalThis[Symbol.for('organon.plugins.host.v1')]`. Outros caminhos React
(por exemplo `react-dom/client`) são recusados. Lucide e helpers próprios podem
ser empacotados; o compilador rejeita React duplicado, imports/chunks residuais,
assets além de JS/CSS e inclusão do outro adicional. Não usar import com alias
de Vite global, criação de outra raiz React ou dependência de CSS global novo.

ABI atual: `1`. Alterações incompatíveis no SDK exigem novo ABI ou compatibilidade
explícita no host; não atualizar o número silenciosamente. Os fontes usam CSS
escopado por domínio. Plugins próprios executam no renderer do Organon e não são
um sandbox para código de terceiros; a confiança vem da chave pública fixa e da
lista fechada de IDs, não de isolamento JavaScript entre os dois adicionais.

Formato do `.organon-plugin` (JSON UTF-8):

```json
{
  "manifest": {
    "format": 1,
    "publisher": "Organon",
    "abi": 1,
    "id": "financeiro",
    "version": "1.0.0",
    "minHost": "0.5.7",
    "maxHostExclusive": "1.0.0",
    "entry": "index.js",
    "files": {
      "index.js": { "size": 123, "sha256": "<64 caracteres hex>" }
    }
  },
  "files": { "index.js": "<bytes em base64 canônico>" }
}
```

Somente `index.js` e `style.css` são aceitos como nomes de arquivo. Não existe
extração de ZIP nem execução de scripts de instalação. Tamanho máximo total do
JSON do pacote: 8 MiB; catálogo: 64 KiB; download: 45 s e até cinco redirects,
somente HTTPS em GitHub e seus hosts de assets permitidos. A lista de assets
originais é fixa em `leosalema213/app-estudos`, com tags estáveis `vX.Y.Z`.

Catálogo: `{payload:string,signature:string}`. A assinatura Ed25519 cobre os bytes
UTF-8 exatos de `payload`; a assinatura usa base64. O payload contém
`{format:1,sequence,expiresAt,plugins:[{id,version,size,sha256,tag,url}]}`.
Não fornecer objeto JSON reserializado como payload nem buscar chave pública da
mesma rede do catálogo. A chave fixa vem do main distribuído pelo Organon.

## API do main

`createPluginManager({directory,hostVersion,publicKey,fetchImpl?,emit?})`:

| Método | Retorno/efeito |
| --- | --- |
| `list()` | `{plugins,configured,busy}`; sem rede; cada plugin tem `id,name,installed,version?,removable,canRollback,availableVersion?,updateAvailable,error?`. |
| `check()` | Baixa/verifica catálogo oficial e sequência; retorna `{checked:true}`; emite lista atualizada. |
| `install(id)` | Exige catálogo fresco consultado nesta sessão; baixa, verifica e ativa atomicamente; retorna `{installed:true,id,version}`. |
| `remove(id)` | Retira do registro e limpa somente pacotes sem referência; retorna `{removed:true,id}`. Não toca nos serviços/dados. |
| `rollback(id,expectedVersion)` | Confere que a versão ativa não mudou, verifica pacote anterior e o restaura; retorna `{restored:true,id}`. |
| `entry(id)` | Só para instalado/verificado: `{id,version,url,css}`; URLs incluem SHA-256 para separar cache de versões. |
| `handleRequest(request)` | Handler de `protocol.handle`, responde somente GET para arquivos exatos da instalação ativa. |

Os métodos rejeitam com Error em falha; a interface exibe a mensagem. Há uma
operação de mutação/download por vez. `emit(status)` entrega eventos somente à
janela confiável configurada pelo host. `list()` não precisa de login, pois
instalação é por dispositivo/perfil Electron. Autorizações de dados continuam
nos serviços/servidor, independentemente do estado do plugin.

## Integração do coordenador (não aplicada aqui)

Antes de `app.ready` no main:

```js
const { createPluginManager, registerPluginIpc, scheme } = require('./plugins.cjs');
protocol.registerSchemesAsPrivileged([scheme]);
```

Depois de `app.whenReady`, registrar o handler na mesma sessão da BrowserWindow:

```js
const plugins = createPluginManager({
  directory: path.join(app.getPath('userData'), 'plugins'),
  hostVersion: app.getVersion(),
  publicKey: ORGANON_PLUGIN_PUBLIC_KEY_PEM, // chave pública fixa do publicador
  emit: status => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('plugins:changed', status);
    }
  },
});
session.defaultSession.protocol.handle('organon-plugin', request => plugins.handleRequest(request));
registerPluginIpc({
  ipcMain, manager: plugins,
  isTrustedSender: event => Boolean(mainWindow) && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame,
});
```

`mainWindow` e o validador de origem devem acompanhar as convenções reais do
main: validar também que a janela continua no documento local autorizado,
e manter bloqueio de navegação. Se houver sessão personalizada, registrar nela,
em vez de defaultSession. Não expor `directory`, URL arbitrária ou chave pelo IPC.
Sem chave pública fixa, a consulta/instalação falha fechada e a UI informa a
indisponibilidade. Não gerar uma chave efêmera em cada startup.

No preload, dentro do objeto `desktop` exposto pelo contextBridge:

```js
plugins: {
  list: () => ipcRenderer.invoke('plugins:list'),
  check: () => ipcRenderer.invoke('plugins:check'),
  install: id => ipcRenderer.invoke('plugins:install', id),
  remove: id => ipcRenderer.invoke('plugins:remove', id),
  rollback: (id, version) => ipcRenderer.invoke('plugins:rollback', id, version),
  entry: id => ipcRenderer.invoke('plugins:entry', id),
  onChanged: callback => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('plugins:changed', handler);
    return () => ipcRenderer.removeListener('plugins:changed', handler);
  },
},
```

Manter `contextIsolation: true`, `nodeIntegration: false` e o sandbox existente.
Na CSP do documento host, acrescentar **somente** `organon-plugin:` a
`script-src` e `style-src`. Não incluir unsafe-eval, blob em script, bypassCSP ou
acesso HTTP externo para executar código. O esquema é standard/secure/CORS/fetch
e não ignora CSP. O handler responde apenas conteúdo previamente autenticado,
com nosniff, no-store e CORS sem credenciais para permitir o host file:// atual.
Não ampliar permissões de connect-src. As APIs de dados continuam via preload.

No shell, importar apenas os arquivos da plataforma:

```jsx
import PluginSettings from './plugin-system/PluginSettings.jsx';
import PluginPage from './plugin-system/PluginPage.jsx';
import usePlugins from './plugin-system/usePlugins.js';

const { installed } = usePlugins();
// Acrescentar navegação somente para installed; nenhuma entrada antes de instalar.
const selected = installed.find(plugin => plugin.id === currentPage);
// Remover/recuperar/atualizar deve desmontar imediatamente a página antiga.
selected && <PluginPage key={`${selected.id}:${selected.version}`}
  id={selected.id} api={moduleApi} user={publicUser} workspace={workspace} />;
// Dentro da aba "Plugins" de Preferences:
<PluginSettings />;
```

Se a página atual deixar de estar instalada, voltar para uma página base. A chave
de renderização inclui versão para não reter código antigo depois da atualização.
Não usar glob eager, import estático, prefetch ou service worker que inclua os
fontes dos adicionais. O build global pode manter `src/plugins/` no checkout:
Vite não os inclui enquanto não houver imports a partir do entry do aplicativo.
O empacotamento atual inclui `electron/**/*`, logo inclui `electron/plugins.cjs`;
os assets `.organon-plugin` são anexos separados de Release, não extraResources.

## Persistência, backups e preservação

Instalações ficam em `<userData>/plugins/installed.json` e
`<userData>/plugins/objects/<sha256>.json`, fora do snapshot de estudos, exportação
pessoal e sincronização. Perfis antigos começam sem instalações. O registro tem
`format:1`, `sequence` e `installed[id]:{current,previous}`; cada referência guarda
`{sha256,envelope}` para verificar a assinatura novamente sem rede. Não confiar
num manifesto que exista apenas no registro sem assinatura correspondente.

Os bytes são gravados em temporário exclusivo e movidos para objeto por hash;
somente depois há rename do registro completo. Erro anterior à troca mantém a
instalação ativa; erro ao importar/renderizar permite recuperação manual em
Preferências. A versão anterior é verificada novamente antes da recuperação.
Arquivos corrompidos ficam desativados e podem ser reparados por reinstalação
autenticada. Arquivos/pastas symlink nos caminhos gerenciados são recusados.
A raiz deve ser um subdiretório privado de userData fornecido pelo main.

A limpeza usa somente arquivos regulares com nome SHA-256 e extensão `.json`
diretamente em `objects`, sem seguir links, extração ou exclusão recursiva.
Mantém atual/anterior e ignora nomes desconhecidos. Temporários são retirados no
finally; desligamento abrupto pode deixar `.tmp` inerte, sem ativação. Não há
reinicialização de dados pessoais nem chamada aos serviços de domínio ao remover.
Pacotes instalados podem funcionar offline mesmo com catálogo expirado; novos
downloads exigem catálogo válido. O maior número de sequência visto é persistido.
Uma versão já instalada não pode ser republicada com hash diferente; alterar os
fontes/compatibilidade exige nova versão do pacote, preservando recuperação e cache.

O coordenador deve registrar no contrato global `docs/DADOS-E-MIGRACOES.md` que
esse registro local não faz parte de backups de estudos/snapshot JSONB e não
exige DDL. Os backups do domínio financeiro/MEI pertencem ao contrato de domínio,
não ao gerenciador de instalações. Nenhum SQL remoto é necessário aqui.

## Geração e assets de Release

Com os fontes de ambos os chats prontos, executar **sequencialmente**, fora de
qualquer build/empacotamento global. Valores abaixo são exemplos para a versão
alvo; o coordenador deve definir a faixa real do host antes de publicar.

```powershell
node "C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\scripts\plugins-build.mjs" --version 1.0.0 --min-host 0.5.7 --max-host-exclusive 1.0.0
```

O comando escreve somente `plugins/out/`: dois pacotes, dois `.sha256` e
`packages.json` local. Sem build do aplicativo, install, commit ou upload.
A geração rejeita preview dos pacotes e assets extra/React duplicado.

Depois, no ambiente de assinatura, configurar `ORGANON_PLUGIN_SIGNING_KEY_FILE`
como caminho de uma chave privada Ed25519 fora do repositório e executar:

```powershell
node "C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\scripts\plugins-catalog.cjs" --tag v0.5.7 --sequence 1 --expires-at "2027-02-01T00:00:00Z"
```

A expiração de exemplo não é uma política fixa. Usar sequência estritamente
crescente nas próximas publicações e janela adequada para suporte. A chave pública
impressa deve corresponder à fixada no host. Não versionar arquivo da chave privada,
nem colocá-lo em renderer, pacote ou Release. Não há chaves criadas por esses scripts.

Assets próprios que a Release estável deve anexar, após aprovação do lote:

- `organon-plugin-financeiro-1.0.0.organon-plugin`.
- `organon-plugin-mei-1.0.0.organon-plugin`.
- Checksums `.organon-plugin.sha256` correspondentes para inspeção humana.
- `organon-plugins-catalog.json`, apontando para os dois pacotes e hashes finais.

`packages.json` é intermediário local e não precisa ser publicado. Cada nova
Release marcada latest deve incluir o catálogo assinado ainda válido, mesmo se
os pacotes apontarem para assets de uma Release anterior. O gerenciador consulta
o catálogo em `/releases/latest/download/organon-plugins-catalog.json`; ausência
retorna erro explícito. Nunca publicar catálogo antes dos pacotes referidos.
Não instalar pacotes com serviço de atualização do app nem incluir previews no
catálogo de produção. Rotação de chave exige atualização autenticada do host;
não existe confiança automática em chaves remotas ou catálogo arbitrário.

## Testes preparados e limites de validação

Executar no terminal do usuário (funciona de `C:\WINDOWS\system32`):

```powershell
node --test "C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\plugins.test.js"
```

Verifica assinatura/expiração/replay, hashes, arquivos arbitrários/traversal,
ABI/compatibilidade, primeira instalação, atualização/recuperação, escrita atômica
com falha, remoção preservando dados sintéticos, reparo, offline/restart,
protocolo estrito, limites de download, IPC, symlinks quando o Windows permitir e
aliases React/componentes do compilador. Usa fetch sintético e diretórios
temporários; não é validação de GitHub real ou do Electron empacotado.

Checagem de sintaxe (`node --check`) dos três arquivos Node e do teste aprovada.
Testes executados pelo usuário em 03/11/2026: **13 aprovados, zero falhas e zero
ignorados**, conforme resumo enviado nesta conversa. Não é necessário repetir
essa execução sem mudança relevante ou falha nova. Após integrar
o shell/CSP e gerar os assets, ainda é necessário validar abertura do pacote real,
estilo/import dinâmico pelo protocolo Electron, fluxo de Preferências e React único
no executável de preview em perfil temporário. Esse teste depende da integração e
deve ser combinado pelo coordenador com o usuário; não usar dados pessoais.

## Pendências

### Lote 0.5.8

- Ao abrir Preferências → Plugins, o aplicativo consulta o catálogo assinado e oferece atualização quando a versão publicada é superior à instalada. A instalação depende do clique do usuário; falhas de rede preservam os plugins locais.
- Downloads usam o fetch do Node no processo principal: o fetch do Electron cancela redirects manuais. Cada destino continua limitado aos hosts GitHub autorizados, com limite de bytes, timeout, assinatura e hashes.
- Financeiro e MEI 1.0.1 foram gerados para hosts a partir de 0.5.8, com catálogo de sequência 2 apontando para v0.5.8. Os arquivos ainda são locais até a publicação autorizada.
- Removido o desvio que carregava fontes locais dos plugins nas prévias. Preview e produção usam os pacotes assinados e o protocolo `organon-plugin`.
- Validação enviada pelo usuário em 03/11/2026: build, 27 testes focados e `tests/modules-ui.cjs` aprovados, incluindo consulta automática, carregamento real dos pacotes assinados e preservação dos dados sintéticos. A rede desse teste é simulada e não comprova o servidor Supabase ou o download público.
- O usuário também aprovou `tests/modules-ui.cjs --packaged` no executável 0.5.8: instalação, abertura e remoção dos pacotes assinados, JavaScript/CSS pelo protocolo real e preservação dos dados, em perfil temporário.

Atualização da coordenação: main/preload/CSP/navegação/Preferências conectados, chave pública fixada e chave privada de assinatura mantida fora do repositório. Contrato global registrado; pacotes 1.0.0 e catálogo assinados gerados separadamente. O publicador agora verifica assinatura, hashes/ABI/compatibilidade e inclui os três assets antes de tornar uma Release pública. Abertura/instalação/remoção dos plugins via protocolo real aprovada pelo usuário em `tests/modules-ui.cjs`; servidor também aprovado em `modules-live.cjs`. O modo `--packaged` também foi aprovado pelo usuário: instalação/abertura/remoção dos pacotes assinados no executável real, JavaScript/CSS pelo protocolo e preservação dos dados. Perfil descartável e rede simulada; não comprova download público do GitHub. Nenhum catálogo/asset foi publicado. A checklist abaixo registra a entrega original do chat; estado consolidado em `../SUPABASE.md`.

- [ ] Coordenador integrar main/preload/CSP/navegação/Preferências com as APIs acima.
- [ ] Definir chave pública estável e política segura da chave privada de publicação.
- [ ] Registrar armazenamento separado no contrato global de dados.
- [x] Usuário executar testes focados e retornar o resumo/erro: 13 aprovados, sem falhas ou ignorados (03/11/2026).
- [ ] Gerar pacotes sequencialmente após estabilização dos dois fontes de domínio.
- [ ] Validar protocolo/import/CSS no Electron empacotado em perfil temporário.
- [ ] Publicar catálogo/assets somente após autorização explícita do lote.
