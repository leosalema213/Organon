# MEI — inventário, contrato e integração

Implementação do chat MEI em 03/11/2026. Propriedade restrita a `src/plugins/mei/`, `electron/modules/mei.cjs`, `tests/mei*` e este documento. Fonte somente leitura: `Z:\financas\src\pages\Mei.tsx` (lido integralmente) e `src/lib/api/{entries,settings,types}.ts`. Nenhum dado pessoal, credencial, migration aplicada ou versão alterada.

## Integração necessária pelo coordenador

- Página padrão `src/plugins/mei/index.jsx`, props `{api,user,workspace}`. Independente do bundle visual financeiro: não importa nada de `src/plugins/financeiro`. Deve entrar no pacote baixável MEI pela plataforma de plugins, sem import estático pelo shell. Instalação/download/remoção pertencem ao chat da plataforma.
- Main: `require('./modules/mei.cjs').createService({cloud,emit})`, registrar `dispatch` para `api.call('mei',action,payload)`. `emit(event)` recebe `{module,orgId,type:'changed'}` sem dados/limites: encaminhar aos subscribers autorizados do módulo. Ações sobre lançamentos/categorias também emitem para `financeiro`. Não emitir configurações de MEI para equipes.
- UI assina `mei` e `financeiro` e recarrega o estado completo autorizado em qualquer sinal. O coordenador deve invalidar `mei` após reconexão e eventos financeiros privados do espaço; os eventos de `financeiro_settings` são exclusivos do proprietário. Esta implementação não abre socket nem implementa fila offline. Realtime remoto, IPC e catálogo são integração compartilhada, ainda pendentes.
- Schema compartilhado **requer revisão positiva default 1 em `financeiro_entries` e `financeiro_settings`, incremento atômico em todo UPDATE**, inclusive por outros escritores. RPCs UPDATE/DELETE validam simultaneamente `id + org_id + revision` sob lock; conflito não grava nada. `financeiro_types` não tem edição aqui e não requer revisão para criação. Escrita direta não pode contornar revisão/invariantes.
- `financeiro_settings`: `id uuid`, `org_id uuid`, **`owner_id uuid not null`**, `year integer`, `mei_limit numeric sem estreitar escala legada`, `created_by uuid`, `revision`. Unicidade `(org_id,owner_id,year)`. Configurações anuais da origem devem ser migradas preservando ano/limite/ID e atribuindo o proprietário de destino; não criar default legal. Ano novo usa insert simples: colisão deve falhar, nunca upsert cego.
- `financeiro_entries`: `id,org_id,description,value numeric sem estreitar escala legada,type_id,entry_type,entry_date,count_for_mei,created_by,created_at,revision`. Preservar `source_created_by` no schema/migração central. Categoria deve pertencer à mesma organização (FK composta ou trigger), validada também pela RPC antes de salvar.
- `financeiro_types`: `id,org_id,name,created_by`. Leitura ordenada por nome, criação com trim. Deduplicação de categorias permanece com a migração central.
- RLS nas tabelas privadas de settings deve validar **`owner_id = auth.uid()` e proprietário atual de organizations**, tanto USING quanto WITH CHECK, sem grants de equipe; proteger mudança de org/owner. Incluir `mei` como acesso de owner na função `organon_can_access_resource`, nunca como grant do convite. O main autentica por `/auth/v1/user` e consulta organization por id + owner antes de cada comando; não confia em `payload.ownerId`, `user` ou `workspace` do renderer. Esse check não substitui as políticas do servidor. Settings/relatórios não entram no snapshot compartilhado financeiro.
- RLS dos lançamentos/categorias pode atender o financeiro compartilhado. MEI usa a mesma base, mas exige owner antes de todo comando. Membros autorizados podem ver os lançamentos financeiros concedidos; não devem receber configurações/arquivos de exportação/relatórios pessoais MEI.
- Registre o contrato de persistência em `docs/DADOS-E-MIGRACOES.md` e prepare DDL em `supabase/modules/financeiro.sql` no chat coordenador. Nenhum DDL foi escrito fora da propriedade MEI. Nenhum serviço remoto foi validado por este chat.

## Tabela de paridade

| Comportamento na origem | Implementação | Caso sintético preparado |
| --- | --- | --- |
| Entrada conta se `countForMei !== false`; projetado conta sempre, gasto nunca | `included`, usado em cada relatório, inclusive após edição | nulos/ausentes, false, gasto e projetado false |
| Data por `entryDate ?? createdAt.slice(0,10)` | `dateOf`, sem converter fuso da data civil | fallback em dezembro com offset |
| Ano atual inicial; ano digitável > 2000; cada ano exige limite próprio | ano atual, input, modal de limite antes de ativar ano sem configuração | anos 2025/2026/2027 separados |
| Nenhum teto presumido | configuração ausente = null, restante não calculado e modal obrigatório no ano inicial | sem configuração retorna `restante:null` |
| Recebido = soma de entradas elegíveis do ano | BigInt com escala alinhada, string decimal na API | 0.10 + 0.20 = 0.30, legado subcentavo |
| Projetado = soma de projetados do ano | mesmo cálculo exato | 0.30 + 0.60 = 0.90 |
| Total anual = recebido + projetado; restante = limite − total anual | sem clamp, cartão de excesso usa módulo do valor | total 1.20, restante 8.80, excesso −1.00 |
| Lista agrupa mês + natureza; descrições concatenadas; items originais preservados | grupos em ordem de mês, entrada antes de projetado, data de criação crescente | dois recebidos e um projetado em janeiro |
| Filtro de mês altera lista, não cartões nem resumo | `groups` filtrado; `monthly`/totais anuais intactos | janeiro mantém total anual e fevereiro no resumo |
| Resumo mostra somente meses com itens; separa recebido/projetado | `monthly` com contagem, total e parcelas | mês populado único e meses vazios omitidos |
| “Média por lançamento projetado” divide pelo número de **meses com saldo projetado > 0**, não lançamentos | rótulo preservado e fórmula original; racional exato, arredondado apenas ao apresentar centavos | três lançamentos em dois meses, meses zero/negativo, meio centavo |
| Criação/edição: descrição, categoria, valor, entrada/projetado, marca MEI somente visível para entrada, data | modal compartilhado, marca preservada ao trocar natureza | validação da edição e remapeamento de campos |
| Grupo com vários itens abre seletor para editar um lançamento | seletor de itens originais com descrição/valor | grupos preservam items para seleção |
| Excluir grupo seleciona **primeiro item**, confirma descrição, remove só ele | mesma regra, confirmação explícita do item e revisão esperada | delete exige revisão |
| Criar categoria no formulário, selecionar após criação | modal compartilhado e `createType` | serviço fechado por espaço |
| JSON mês/tudo inclui exportedAt, mode, settings e lançamentos individuais do ano | `exportReport`; “tudo” é ano selecionado | escopo, settings e itens individuais |
| CSV `ano;mes;tipo;descricao;valor`, descrição entre aspas e aspas duplicadas | preserva colunas/valores/conteúdo, sem flutuação monetária | ponto e vírgula, aspas, quebra de linha |
| Nome `relatorio-mei-ANO-MES` ou `-completo` | mesmas convenções, extensão e MIME | arquivo mensal e anual |

Diferenças intencionais de correção: a origem filtra `countForMei` só no carregamento inicial e pode manter temporariamente no total uma entrada desmarcada após editar. Aqui o filtro se aplica sempre. A origem fecha o modal de limite mesmo em falha de gravação; aqui permanece aberto, com erro. Não copiado o exemplo numérico de teto do placeholder (evita sugerir valor legal). Valores são strings decimais nas exportações JSON, preservando precisão; importadores precisam aceitar string decimal além de número legado. CSV mantém o formato da origem. Não há importação JSON/CSV na tela MEI de origem; não foi adicionada importação destrutiva.

## API fechada

Todos os payloads incluem `orgId`. Datas `YYYY-MM-DD`; valores monetários string decimal (`12.34` ou entrada `12,34`), incluindo escala legada maior que centavos sem truncamento. Nunca enviar somas como Number. IDs são UUIDs; user/owner/autor são derivados da sessão no main e verificados no servidor.

| Ação | Payload adicional | Retorno |
| --- | --- | --- |
| `load` | `year`, `month: 'all' ou 1..12` | `{year,month,settings,allSettings,types,entries,groups,monthly,recebido,projetado,totalAno,restante,mediaProjetada,projectedMonths}` |
| `export` | `year,month,mode:'all'/'monthly',format:'json'/'csv'` | `{filename,type,content}`; month obrigatório no modo monthly |
| `saveSettings` | `year,meiLimit`; para atualizar `id,expectedRevision` | `{id,orgId,ownerId,year,meiLimit,revision,createdBy}` |
| `createEntry` | `requestId,description,value,typeId,entryType,entryDate,countForMei` | lançamento normalizado, com revisão (ou `{ok:true}`) |
| `updateEntry` | campos completos do create, sem requestId, + `id,expectedRevision` | lançamento normalizado, com nova revisão (ou `{ok:true}`) |
| `deleteEntry` | `id,expectedRevision` | `{id}` |
| `createType` | `name` | `{id,name,orgId}` |

`entries` contém itens MEI do ano, sem agrupamento; `groups` recebe filtro mensal; `monthly` e os cartões sempre usam ano inteiro. `settings` ausente é null (não significa limite zero). O serviço não encaminha natureza gasto. A RPC deve recusar editar por ID uma entrada fora do conjunto MEI; desmarcar entrada no próprio formulário é permitido e a remove do relatório após salvar. Categoria vazia é aceita pelo serviço para compatibilidade de dados legados, mas o formulário de criação exige selecionar/criar categoria, como na origem.

### RPCs obrigatórias do schema coordenado

Não há escrita REST direta de tabela ou dependência do módulo visual financeiro. Além de `/auth/v1/user` e leitura fechada do owner em `organizations`, o serviço chama somente as duas RPCs abaixo. Ambas devem verificar `auth.uid()` como **proprietário atual do espaço em toda execução**, independentemente de grants financeiros. Serviço falha se a RPC não existir; não há fallback inseguro.

`mei_snapshot(p_org_id uuid) returns jsonb`:

```js
{ entries: [{ id,orgId,description,value:'0.001',typeId,entryType,entryDate,
    countForMei,createdBy,sourceCreatedBy,createdAt,revision:1 }],
  settings: [{ id,orgId,ownerId,year,meiLimit:'10.00',createdBy,revision:1 }],
  types: [{ id,orgId,name,createdBy,sourceCreatedBy }] }
```

Retornar dataset financeiro completo desse espaço e configurações de **`owner_id=auth.uid()`**, em uma leitura consistente (agregação JSON única, não truncada no limite de linhas PostgREST). Pode devolver todos os lançamentos; filtro de elegibilidade é aplicado pelo domínio MEI. Ordenar o array de entradas por `entry_date desc` como a API da origem, preservando a ordem de desempate quando `createdAt` for igual no agrupamento. `value::text`/`mei_limit::text` devem ser aplicados **antes** de construir o JSON, para impedir perda no parser JavaScript. Números JSON são recusados pelo main. Não incluir settings no snapshot financeiro/equipe.

`mei_mutate(p_org_id uuid,p_action text,p_payload jsonb) returns jsonb`:

| p_action | p_payload | Resposta |
| --- | --- | --- |
| `saveSettings` | `{year,meiLimit:string,id?:uuid,expectedRevision?:integer}` | `{ok:true,settings:Setting}` obrigatório |
| `createEntry` | `{requestId,description,value:string,typeId,entryType,entryDate,countForMei}` | `{ok:true,entry?:Entry}` |
| `updateEntry` | `{id,expectedRevision,description,value:string,typeId,entryType,entryDate,countForMei}` | `{ok:true,entry?:Entry}` |
| `deleteEntry` | `{id,expectedRevision}` | `{ok:true}` |
| `createType` | `{name}` | `{ok:true,type:Type}` obrigatório, criada ou existente canônica |

RPC deve reutilizar os invariantes/transações financeiros sem conceder MEI a membros: bloquear registro antes de validar revisão, validar natureza atual elegível (entrada com flag diferente de false ou projetado), categoria da mesma org e nova natureza entrada/projetado, preservar autor histórico, derivar autor/org/owner da sessão. Mudança de year/org/owner de settings por ID deve ser rejeitada. Insert de settings para ano existente deve falhar sem sobrescrever. `createEntry` usa idempotência por usuário/espaço/requestId e hash do payload, como financeiro; UI mantém requestId ao repetir o mesmo formulário. `createType` recomputa normalização NFKC/trim/espaços/caixa no servidor e devolve ID canônico sob concorrência. Conflito retorna `{conflict:true}` sem alteração ou erro SQL; main mantém rascunho. Nunca confiar em autoria, grants ou revisão nova enviada pelo renderer.

BigInt fica exclusivamente nas funções puras internas; todos os valores transmitidos são serializáveis. Somas alinham escala decimal arbitrária, sem estreitar valores legados. A média é razão exata de unidades e meses positivos, arredondada half-away-from-zero só na exibição em centavos. Totais/CSV preservam casas adicionais existentes; JSON conserva strings originais. Sem aritmética monetária binária.

## Implementação e validação

- `electron/modules/mei.cjs`: domínio monetário puro, relatório, exportação, validação, owner gate, transporte autenticado e gravações com revisão.
- `src/plugins/mei/index.jsx`: página instalável, relatórios/lista, filtros/ano, criação/edição/exclusão, seletor de item, categorias, limite anual, download e subscriptions. Usa `Modal`/`PopupMenu` do Organon, sem cache global de dados privados; troca de conta/espaço remonta a página e descarta respostas antigas.
- `src/plugins/mei/mei.css`: estilos escopados, tipografia/controles do shell, cores por variáveis da paleta, superfícies herdadas e dark neutro.
- `tests/mei.test.js`: testes de domínio e serviço com transporte sintético; não usa contas, banco nem dados reais. **Executados pelo usuário em 03/11/2026: 22 testes aprovados, zero falhas, cancelamentos ou testes ignorados (212,0319 ms)**, conforme resumo enviado neste chat. Mocks não validam RLS, DDL ou servidor real. Sintaxe do serviço/testes conferida com `node --check`; JSX analisado com `transformWithOxc` do Vite, sem build.

Comando PowerShell único e focado, executável de qualquer diretório:

```powershell
node --test "C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\mei.test.js"
```

Pendências: integração do catálogo baixável/IPC/main pelo coordenador e plataforma; implementação/aplicação central de `mei_snapshot`/`mei_mutate` com revisão atômica e settings owner-only; migração anual e auditoria decimal; validação real de RLS com proprietário e membro negado; canal privado Realtime e refetch de reconexão; revisão visual pelo usuário no aplicativo integrado. Nenhum build, suíte ampla ou E2E executado aqui. A execução focada pelo usuário foi concluída com os 22 testes aprovados.

Referências consultadas: [PostgREST — cast de colunas](https://docs.postgrest.org/en/stable/references/api/tables_views.html#casting-columns), [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [changelog Supabase](https://supabase.com/changelog). O endpoint `.md` do changelog falhou por tipo de conteúdo; consultada a versão HTML. Sem alteração remota.
