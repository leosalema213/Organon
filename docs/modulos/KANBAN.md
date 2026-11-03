# Kanban no aplicativo base

Implementado em 03/11/2026, no checkout compartilhado. Fonte consultada somente para leitura: `Z:\financas\src\pages\Kanban.tsx`, `src/lib/api/kanban.ts` e `src/lib/tagIcons.tsx`. Nenhum dado pessoal, token ou arquivo da origem foi copiado. Não houve alteração de versão, commit, publicação, build, migração ou aplicação de SQL remoto.

## Inventário funcional da origem e implementação

| Comportamento real da origem | Implementação no Organon |
| --- | --- |
| Selecionar/criar/renomear/excluir quadros; ordenar por criação | Seletor de quadros, formulário e confirmação de exclusão em cascata. |
| Fundo nenhum, cor, imagem; preencher ou repetir | Mesmos campos `bg_type`, `bg_color`, `bg_image_url`, `bg_size`; presets originais e seletor de cor. Imagem enviada ao main para Storage privado. |
| Criar/editar/excluir listas com nome/cor/posição | Colunas com mesmos identificadores/campos legados, presets originais, cor personalizada e confirmação de exclusão com cartões. |
| Cartões: título, descrição com emoji, preço opcional, miniatura opcional | Formulário com `RichTextField` compartilhado, preço decimal textual, imagens, remoção e prévia. Zero é preservado como valor, corrigindo a perda causada pelo `price || null` da origem. |
| Descrição original e mídia/HTML importado | Texto original não é reserializado só por abrir/salvar. HTML original pode ser inspecionado/editado em campo próprio; o editor visual compartilha o schema do Organon. Imagens do HTML mantêm o `src` por node próprio do editor. |
| Marcadores globais por organização: nome/cor/ícone | CRUD completo, inclusive sem nenhum quadro criado; os mesmos 47 nomes de ícone da origem, com fallback visual para `Tag`, sem reescrever nomes desconhecidos no banco. |
| Vínculos muitos-para-muitos cartão/marcador | Seleção de vários marcadores salva junto com o cartão numa única transação. Marcadores removidos são desvinculados de todos os cartões. |
| Busca de título/descrição + filtro por tags | Busca sem diferença de caixa; OU entre os marcadores selecionados e E com o texto; limpar filtros, contagem/resultados, abertura do cartão encontrado e coluna indicada. |
| Arrastar cartões entre colunas; manter posição | Movimento entre colunas e reordenação dentro delas; também menus acessíveis para cima/baixo ou outra coluna. Reordenação de colunas por arraste ou esquerda/direita. Destino usa `beforeId`, não um índice de tela filtrada. |
| Confirmação de exclusões | `Modal` compartilhado para quadro, coluna, cartão e marcador, explicando cascatas. |
| Atualização de estado da origem | Reconsulta autorizada depois de operações, eventos e reconexão/foco. Sem cache persistido de recursos de equipes e sem escrita offline compartilhada. |

A página exporta componente padrão em `src/kanban/index.jsx`, recebe `{api,user,workspace}` e usa somente componentes/layout do Organon. Não depende dos plugins, Tailwind, roteador, tema, supabase-js ou AuthContext da origem. Menus usam `PopupMenu`; CSS fica em `kanban.css`, com superfícies dark neutras e cores explícitas preservadas nos acentos.

## API do renderer e integração do coordenador

```jsx
import Kanban from './kanban/index.jsx';
<Kanban api={api} user={publicUser} workspace={workspace} />
```

No main:

```js
const { createService } = require('./modules/kanban.cjs');
const service = createService({ cloud, emit: event => publishModuleEvent('kanban', event) });
// No roteador fechado de módulos: service.dispatch(action, payload).
```

`publishModuleEvent` é exemplo de ligação ao transporte central, não uma nova dependência do módulo. O serviço retorna `{dispatch}` e não abre IPC por conta própria. `cloud.ready`, `cloud.token()` e `cloud.request()` são usados no main existente. A flag `cloud.enabled === false` bloqueia operação; falta de sessão/conexão gera erro, sem fingir persistência local.

Todos os payloads têm `orgId`. Os de quadro existente, colunas, cartões e imagens têm `boardId`. Atualizar/excluir/mover registro exige `id` e `expectedRevision` obtida da leitura. Campos extras (autor, role, tabela, endpoint) são descartados no main. O banco deriva autoria de `auth.uid()` e revalida todas as relações e permissões.

| Ação permitida | Campos adicionais | Retorno |
| --- | --- | --- |
| `getBoards` | nenhum | Array de quadros autorizados, com revisão e campos legados. |
| `getTags` | nenhum | `{tags,canManageTags,canCreateBoard}` para o catálogo autorizado, inclusive quando não há quadros. |
| `getBoard` | `boardId` | `{board,lists,cards,tags,cardTags,canWrite,canManageTags}`. |
| `saveBoard` | `name,bg_type,bg_color,bg_image_url,bg_size`; `id,boardId,expectedRevision` ao editar | Quadro salvo. Criar aceita apenas imagem nula até existir um ID autorizado. |
| `deleteBoard` | `boardId,id,expectedRevision` | `{id,deleted:true}`. |
| `saveList` | `boardId,name,color`; `id,expectedRevision` ao editar | Coluna salva, posição de criação calculada no servidor. |
| `deleteList` | `boardId,id,expectedRevision` | `{id,deleted:true}`. |
| `moveList` | `boardId,id,expectedRevision,beforeId` ou `null` para o final | Coluna movida. |
| `saveCard` | `boardId,listId,title,description,price,thumbnail_url,tagIds`; `id,expectedRevision` ao editar | Cartão salvo; vínculos substituídos atomicamente na mesma RPC. Mudar coluna exige `moveCard`. |
| `deleteCard` | `boardId,id,expectedRevision` | `{id,deleted:true}`. |
| `moveCard` | `boardId,id,expectedRevision,listId,beforeId` ou `null` | Cartão movido dentro do mesmo quadro. |
| `saveTag` | `name,color,icon`; `id,expectedRevision` ao editar; `boardId` opcional | Marcador global salvo. |
| `deleteTag` | `id,expectedRevision`; `boardId` opcional | Exclusão global e remoção de vínculos. |
| `uploadAsset` | `boardId,kind:'background'|'thumbnail',data` (data URL PNG/JPEG/WebP) | `{reference}` relativa ao bucket privado. |
| `getAsset` | `boardId,reference` | `{data}` com data URL, sem token. Referência HTTPS legada retorna `{data:null,legacy:true}`. |

Limites: nomes de quadro/coluna 300 caracteres, marcador 150, título 1000, descrição 200000, até 100 marcadores por cartão; preço com até 12 dígitos inteiros e duas casas, sem notação exponencial, aceita vírgula na entrada e envia decimal textual. Servidor limita payload a 1 MB. A UI reduz fundos até 1920 px/1 MB e miniaturas até 1280 px/500 KB; o main valida assinatura, MIME e limite absoluto de 5 MB. Nenhum caminho de arquivo, SQL ou REST arbitrário é aceito do renderer.

## SQL, autorização e concorrência

`supabase/modules/kanban.sql` é um contrato preparado, **não aplicado nem validado contra o servidor**. Aplicar centralmente após `teams.sql` e sua função `public.organon_can_access_resource(uuid,text,uuid,boolean)`. Exige `public.organizations`, Auth, Storage e Realtime existentes. Não presumir que o Supabase pendente esteja operacional.

- Tabelas preservadas: `kanban_boards`, `kanban_lists`, `kanban_cards`, `kanban_tags`, `kanban_card_tags`; mesmas relações por UUID. Revisão/defaults e `updated_at` são aditivos. `source_created_by` guarda UUID histórico em quadros/cartões/marcadores; `created_by` precisa de conta válida no destino. Nenhuma conta é criada pela migração do módulo.
- RLS em todas as tabelas; SELECT por quadro autorizado e por seus filhos. Sem permissões diretas de escrita para PUBLIC/anon/authenticated: é obrigatório usar a RPC com revisão. O script recusa políticas preexistentes desconhecidas para que o coordenador as revise, em vez de manter políticas permissivas da origem.
- `public.organon_kanban` é SECURITY INVOKER. Leituras respeitam RLS. Escritas chamam função SECURITY DEFINER em schema privado não exposto, com `search_path=''`, checagem de `auth.uid()`, ações fechadas e verificações explícitas de espaço/quadro/coluna/cartão/marcador. Não há SQL dinâmico nem autor/role vindo do cliente. EXECUTE revogado de PUBLIC/anon.
- Trava da linha de organização (a mesma usada por equipes para revogação/permissões), depois trava consultiva por organização; grants são conferidos depois da trava. CAS da revisão do registro dentro da transação. Uma revisão antiga gera SQLSTATE `40001`, convertido no main para `CONFLICT`, sem retry que sobrescreva dados.
- `saveCard` atualiza cartão e vínculos na mesma transação. Movimento/reordenação normaliza o destino e altera revisões dos registros afetados. Mudanças de cartões incrementam a revisão da coluna e do quadro; excluir marcador invalida revisões dos cartões/colunas vinculados. A UI relê o agregado após a escrita; não deve tratar a revisão do pai anterior como atual.
- Revogações posteriores não dependem do estado do renderer. Identificadores de coluna/cartão de outro quadro ou organização são recusados pelo servidor. Exclusões de quadro/coluna usam revisão do agregado para detectar filhos editados desde a leitura.
- Marcadores pertencem à organização, como na origem. Gestão global exige acesso de escrita a **todos** os quadros, ou proprietário. Acesso por seleção só vê/atribui marcadores já ligados ao quadro autorizado; não enumera nomes globais não usados. Essa restrição evita vazamento de marcadores de quadros privados. Não criar tabela paralela de tags por quadro.

## Eventos privados

Escritas emitem `changed` por `realtime.send(...,true)`, contendo apenas `orgId`/`boardId`, sem título, descrição, preço, nome de marcador ou conteúdo. Tópicos: `kanban:<orgId>` para quem pode ler todos; `kanban:<orgId>:<boardId>` para leitores do quadro. O SQL prepara SELECT policies em `realtime.messages`, sem escrita de Broadcast pelo cliente e sem alterar o RLS interno desse schema.

Integração central pendente: abrir os canais com `private:true`, autenticar exclusivamente no main, encaminhar os eventos para `api.subscribe('kanban',listener)` e emitir invalidação na reconexão. Ao alterar/revogar grants ou trocar de conta, equipes/main deve invalidar o módulo e renovar/remover os canais. A página limpa sua árvore na troca de usuário/espaço, e recarrega recursos na invalidação, foco e retorno online; não assume que eventos perdidos possam ser reconstruídos. Eventos de escrita local usam o mesmo `emit` injetado. O botão Atualizar permanece disponível. Nenhum conteúdo novo é transmitido pelo Broadcast a uma assinatura antiga de um membro revogado; toda leitura seguinte passa novamente por RLS.

Referências técnicas consultadas: [autorização de canais privados](https://supabase.com/docs/guides/realtime/authorization), [Broadcast do banco](https://supabase.com/docs/guides/realtime/broadcast) e [controle de acesso do Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Assets privados e migração/exportação

Bucket `organon-kanban`, privado, objetos imutáveis: `<orgId>/<boardId>/<uuid>.png|jpg|webp`. Políticas de leitura e upload verificam **o quadro** e sua organização. Não há policy de overwrite/delete por este módulo: remoções visuais não removem bytes ainda referenciáveis por backups. Limpeza de órfãos requer inventário de referências e política de retenção do coordenador.

Coordenador deve copiar os bytes legados de `kanban-board-bgs` e `kanban-thumbnails`, verificar hashes e somente depois substituir `bg_image_url`/`thumbnail_url` por referências relativas do bucket de destino. Referências a imagens dentro de HTML precisam do mesmo inventário/remapeamento. URLs antigas são preservadas verbatim ao salvar um registro sem trocar sua imagem, mas não são buscadas pelo main nem expostas como imagens remotas na UI; até a migração, aparece indicação de imagem indisponível. Nunca converter o bucket novo em público nem copiar uma URL assinada transitória como valor definitivo.

Para o contrato global de dados/backups, que é propriedade do coordenador: incluir as cinco coleções (quadros, colunas, cartões, marcadores e vínculos), todas as colunas conhecidas, UUIDs, posições, autoria de origem e revisões. Validar relações e organização antes de importar; default de revisão para registros antigos é 1. `bg_type`/`bg_size` antigos ausentes recebem `none`/`cover`; descrições ausentes recebem string vazia, preço/imagens ausentes recebem null. Não reatribuir IDs nem reutilizar revisão antiga para sobrescrever uma edição do servidor. O payload de sincronização compartilhada é por registro via RPC; não inserir o snapshot pessoal completo para compartilhar quadro. Assets e seu mapa/hash precisam acompanhar exportação/importação. Um backup antigo sem Kanban significa coleção ausente, **nunca ordem para apagar quadros remotos**. A integração efetiva em backups/modelo/sync e `docs/DADOS-E-MIGRACOES.md` é central e ainda precisa ser feita.

## Arquivos e validação

Implementados: `src/kanban/index.jsx`, `model.js`, `icons.jsx`, `kanban.css`; `electron/modules/kanban.cjs`; `supabase/modules/kanban.sql`; `tests/kanban.test.js`; `tests/kanban-rls.sql`; este documento. Nenhum arquivo global de outro chat foi editado.

Conferência essencial executada pelo agente: `node --check` passou para serviço, modelo e testes; parser JSX do Vite (`transformWithOxc`, sem build nem gravação em dist) passou para página/ícones. O usuário executou `tests/kanban.test.js` e informou 8 testes aprovados, zero falhas e nenhum teste ignorado (247,6981 ms). Testes E2E, verificação visual ampla e testes de banco continuam pendentes.

Comando único preparado para o terminal PowerShell do usuário (qualquer pasta):

```powershell
node --test "C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\kanban.test.js"
```

Verifica contrato fechado de IPC, revisão/erros, save atômico em uma RPC, preservação de HTML/emoji/zero, ausência de autor/role arbitrários, preços decimais, bloqueio sem sessão, limites/referências de imagens, transporte privado e filtros/ordem. Transporte sintético **não valida o Supabase real**.

`tests/kanban-rls.sql` está preparado para banco Supabase **descartável/local**, como administrador após os contratos. Usa contas sintéticas `example.invalid`, testa isolamento, proibição de REST write, CAS/vínculos, movimento entre organizações, marcadores globais, somente leitura e revogação, terminando em ROLLBACK. Não executar em produção. Uma disputa simultânea real entre duas sessões, aplicação de DDL, advisors, Storage real e Realtime real continuam sob validação central.

## Pendências de integração e validação

- [ ] Coordenador: registrar serviço no roteador fechado main/preload e página na navegação base, passando identidade pública/espaço e eventos.
- [ ] Coordenador: aplicar/revisar SQL depois de equipes em ambiente autorizado; conferir privilégios/políticas legadas, schema importado e autoria/FKs antes da migração.
- [ ] Coordenador: ligar canais privados, invalidação de permissões/reconexão e remoção de canais ao sair/trocar de conta.
- [ ] Coordenador: migrar assets por bytes/hash, remapear referências (inclusive HTML), incluir contratos globais de backup/importação/sync sem compartilhar dados pessoais.
- [x] Usuário: executar o comando focado acima e enviar resumo ou erro. Resultado recebido: 8 testes aprovados, zero falhas e nenhum ignorado.
- [ ] Validação central: executar SQL sintético em ambiente descartável; disputa de duas sessões; acesso autorizado/negado a Storage; broadcasts privados e reconexão reais.
- [ ] Revisão manual da UI integrada: fundos preencher/repetir, menus por teclado/Esc, arraste e movimentos acessíveis, preço zero, imagens, marcadores, filtros, confirmações e preservação de rascunho em conflito.

Limitações explícitas: sem fila durável/escrita offline de equipes; sem validação remota nesta conversa; sem exclusão automática de assets; HTML não suportado pelo schema compartilhado pode ser normalizado **se o usuário o editar visualmente** (campo original permite conservar/editar a representação completa). Conflito mantém o rascunho aberto e exige reabrir o registro atualizado antes de reaplicar alterações; não existe resolução automática que sobrescreva outra pessoa.
