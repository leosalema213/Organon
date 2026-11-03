# Integração backend dos módulos

Estado da coordenação: main/preload, fábrica oficial Realtime, IPC, shell, plugins e abertura/edição de compartilhados conectados na 0.5.7-preview.1. SQL aplicado e migração auditada no servidor. Posição de livros compartilhados é uma preferência local separada por conta/espaço/livro/hash. A execução integrada e os fluxos reais ainda estão em validação; o texto de pendências ao fim descreve a entrega original deste agente. O estado atual consolidado fica em `../DADOS-E-MIGRACOES.md` e `../SUPABASE.md`.

Implementação preparada no escopo `electron/business.cjs` e `tests/business.test.js`. Nenhum SQL, migração, build ou teste foi executado por este agente. Main/preload/cloud/shell e arquivos dos outros módulos não foram editados. O coordenador ainda precisa conectar este roteador e validar servidor/Realtime reais.

## Contrato para o main

```js
const { createBusiness } = require('./business.cjs');
const business = createBusiness({
  cloud, plugins, readData, books,
  emit: event => win.webContents.send('modules:changed', event),
  createRealtimeClient: async ({ cloud }) => authenticatedClient,
  validateSharedResource,
});
```

- `cloud` é o controlador existente; tokens permanecem somente no main. `plugins.list()` retorna o contrato do gerenciador de plugins. `readData()` devolve o snapshot pessoal corrente, síncrono ou Promise. `books` é `BookFiles` do perfil local.
- `createRealtimeClient({cloud})` é injetado pelo coordenador. Pode ser assíncrono e deve retornar um cliente Supabase autenticado sem persistência própria de Auth. O roteador chama `client.realtime.setAuth(token)` quando o token muda. O coordenador deve usar o cliente oficial vendorizado; este arquivo não importa pacote npm externo.
- `validateSharedResource` é o sanitizer confiável já previsto por equipes para a ação `editResource`. Deve preservar IDs/referências privadas e validar a forma do caderno/livro; não aceitar plano ou snapshot pessoal inteiro.

| Método | Uso |
| --- | --- |
| `dispatch(module, action, payload={})` | Única fronteira de comandos; módulos `teams/kanban/financeiro/mei`, ações fechadas dos serviços. Financeiro/MEI exigem adicional instalado em cada chamada. |
| `watchWorkspace(orgId)` | Valida espaço próprio/aceito, remove canais anteriores e assina somente canais autorizados. `null` retira assinaturas de domínio. |
| `syncSession()` | Executar após carregar/mudar/sair da conta e ao renovar token; chamadas repetidas com o mesmo usuário não recriam canais. Retorna `{connected,realtime}`. |
| `dispose()` | Encerra canais e descarta identidade/serviços; chamar ao fechar a janela/app. Não revoga a sessão Auth do usuário. |

Main/preload devem validar remetente e frame como as outras APIs do app. Não expor o objeto business, cliente Supabase, arquivos locais, URL/REST arbitrários ou `cloud` no renderer. O roteador rejeita módulo desconhecido e payload acima de 8 MiB. Cada serviço mantém sua validação de ações, campos, relações e revisão esperada.

## Identidade, eventos e Realtime

Os serviços recebem uma fachada presa à geração da conta. Trocar/sair da conta invalida chamadas em andamento: uma resposta antiga não pode reaparecer na sessão nova. Não há cache de conteúdo compartilhado no roteador. Cada leitura é novamente autorizada no servidor, inclusive quando o binário do livro já está no cache local.

Eventos do main têm somente `{module,type,orgId?,boardId?,status?}`. Payloads do Broadcast, registros e credenciais nunca são encaminhados. Tipos incluem `changed`, `invalidate`, `resync` e `connection`; status só contém rótulos fechados, não erros brutos do SDK. O renderer deve tratar `resync` como reconsulta autorizada e limpar páginas/dados na troca de conta/espaço.

- Equipes usa `teams:user:<UUID>`, via ciclo `start/stop` do serviço existente. Mudanças de vínculos/permissões e recursos compartilhados invalidam o catálogo e renovam os canais de domínio.
- Kanban usa `kanban:<orgId>` para quem pode ler todos os quadros, ou canais `kanban:<orgId>:<boardId>` para a seleção de quadros atualmente visível pela RPC.
- Financeiro usa `financeiro:<orgId>`, somente com plugin Financeiro ou MEI instalado e permissão de leitura financeira. O aviso também invalida a página MEI; a consulta MEI continua exigindo dono no serviço/servidor.
- Todos os canais são `private:true`. Entrar ou reentrar em `SUBSCRIBED` emite `resync`. RLS permanece necessária nas tabelas, Storage e `realtime.messages`.
- Factory ausente retorna `realtime:false`; não é prova de colaboração em tempo real. Falhas de conexão são informadas. Não há escrita compartilhada offline, fila de operações ou promessa de replay de eventos perdidos.

## Recursos compartilhados

As ações extras são `api.call('teams','openResource',{orgId,module,resourceId})` e `api.call('teams','downloadBook',{orgId,resourceId})`. Não aceitam bucket, URL ou caminho do renderer.

`openResource` lê uma linha atual de `organon_shared_resources` sob RLS, confere a identidade retornada e retorna `{org_id,module,resource_id,revision,content,canWrite}`. Para cadernos, referências de imagens viram data URLs somente depois de validar bucket, prefixo do recurso, SHA-256, tamanho e assinatura MIME. Há nova conferência de acesso antes de devolver o conteúdo. Limites por abertura: 20 MiB por imagem, 32 MiB de imagens únicas, profundidade 100 e 100 mil nós. Exceder o limite aborta a abertura, sem substituir dados pessoais nem retornar uma cópia parcial.

Para livros, `openResource` devolve somente metadados (sem `file`). `downloadBook` retorna os metadados atuais, `fileReady:true` e `book` com defaults de leitura novos e sem vínculos de plano/progresso/conclusão da pessoa que compartilhou. O coordenador pode abrir o leitor existente com esse objeto, mantendo o progresso do compartilhado separado do snapshot pessoal.

Publicação de livros usa o adapter local existente para extrair apenas `{id,title,format,hash,size}` e um override de transporte:

```js
file: {
  version: 1, hash: '<sha256 integral>', size: 123,
  chunks: [{ bucket: 'organon-shared', object: '<orgId>/books/<resourceId>/<sha256>', size: 123, sha256: '<sha256 da parte>' }]
}
```

Cada parte tem até 4 MiB, abaixo do limite individual do plano Free. A lista `assets` da publicação contém os nomes imutáveis de todas as partes; mantém o contrato SQL atual de prefixo/hash por recurso. Bytes são verificados com `BookFiles.check` antes de publicar. Duplicatas remotas são baixadas e conferidas por hash antes de reutilizar. A cópia só é publicada depois de terminar os uploads.

Download confere quantidade/tamanho/hash das partes, SHA-256 integral, assinatura/formato e limite existente de 200 MiB. Revalida a autorização antes de instalar e antes de devolver. Somente `BookFiles.put` grava o binário por temporário/rename; não cria ou altera `compasso.json`, `books` do snapshot, histórico ou preferências. Cópias antigas de livro com `file:{bucket,object}` ainda podem ser lidas, dentro dos limites locais. O preparo/download continua usando memória de um arquivo completo, como a biblioteca existente.

Imagens dos cadernos continuam no adapter `createLocalAdapters`, com verificação prévia de tipo/assinatura/tamanho acrescentada pelo roteador. Originais pessoais permanecem intactos. A imagem embutida em HTML legado continua preservada no HTML; este lote não reescreve o HTML importado para introduzir referências arbitrárias.

Revogação impede novas consultas/transferências. Como em qualquer arquivo já entregue, ela não apaga retroativamente os bytes do cache da máquina da pessoa. Não exibir/abrir um cache sem uma consulta atual autorizada.

## Testes preparados

`tests/business.test.js` cobre fronteira de módulos/plugins, identidade presa à sessão, eventos sem credenciais/dados, ciclo de canais privados, troca de conta durante uma consulta, publicação de livro em partes, preservação de dados pessoais, cache sem bypass de autorização, corrupção de parte e imagens fora do escopo do caderno. Rede e cliente Realtime são simulados; não validam o servidor real.

Comando focado para o terminal do usuário:

```powershell
node --test "C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\business.test.js"
```

Pendências: conectar IPC/lifecycle/factory oficial no main; integrar viewer/editor dos recursos compartilhados e progresso local separado; executar os testes; validar com duas contas reais isolamento, revogação, troca de conta, Storage e reconexão dos canais. O SQL do bucket compartilhado deve aceitar as partes de até4MiB; aumentar bucket para 200MiB sozinho não supera o limite global do plano Free.
