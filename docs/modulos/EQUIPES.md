# Equipes — implementação e integração

Atualizado em 03/11/2026. Escopo limitado a `src/teams/`, `electron/modules/teams.cjs`, `supabase/modules/teams.sql`, `tests/teams*` e este documento. Não foram alterados main/preload/model/backups, versão ou arquivos dos outros módulos. Nenhum dado real foi incluído, SQL aplicado, migração executada ou publicação feita.

## Inventário confirmado da origem

Leitura de `Z:\financas\src\pages\Team.tsx` e `Z:\financas\src\lib\api\members.ts`, somente leitura:

- Listagem por organização, nome/avatar/função, cache por organização, indicadores de carregamento, erro/sucesso e contagem de administradores/editores.
- Funções globais admin/editor/viewer, alteração de função e remoção de pessoa alterando `profiles.org_id/role`.
- Convite por e-mail através de Edge Function `invite-member`, com mensagem de criação de conta por e-mail.
- A tela verifica admin/master para ações; esse controle visual não demonstra autorização segura no servidor. As políticas legadas **não foram copiadas**. Não foi feita auditoria remota do projeto de origem.

Novo fluxo substitui e-mail/SMTP e papéis amplos por convite UUID, aceite explícito e grants granulares. Contagens de papéis legados e cache em armazenamento pessoal não foram portados por não representarem a nova matriz.

## Arquivos implementados

- `src/teams/Teams.jsx`: página padrão `{api,user,workspace}`, espaços, criação, notificações, busca limitada, desambiguação por nome/apelido/UUID, convite, aceitar/recusar, leitura de aviso, revisão e remoção com confirmação em Modal compartilhado.
- `src/teams/Permissions.jsx`: matriz nenhum/todos/selecionados, checkbox de escrita e nomes em português. IDs fora do catálogo continuam visíveis e removíveis; abrir o editor não apaga grants existentes.
- `src/teams/Sharing.jsx`: publicação, atualização com revisão e retirada de cópias individuais de cadernos/livros. Cópias sem original local podem ser retiradas.
- `src/teams/teams.css`: CSS escopado, escala e botões existentes, dark neutro, cores de tema herdadas.
- `electron/modules/teams.cjs`: transporte fechado, validação, CAS, adapters de extração e upload privado, ciclo Realtime sem repassar eventos brutos ou credenciais.
- `supabase/modules/teams.sql`: contrato SQL transacional preparado; depende de `supabase/profile.sql`, Auth, Storage e Realtime. É instalação única, **não** script idempotente de reaplicação. Organizações já existentes com políticas fazem o script abortar para revisão explícita; organizações sem dono ficam inacessíveis até o mapeamento central.
- `tests/teams.test.js`: testes unitários de matriz, fronteira do transporte, revisões, identidade, compartilhamento isolado, extração sem progresso pessoal, assets e Realtime.
- `tests/teams-rls.sql`: roteiro transacional sintético com rollback para Supabase local descartável, cobrindo pendência/aceite, intruso, MEI, seleção, somente leitura, CAS e revogação.

## API do main

`createService({cloud,realtimeClient,emit,readData,readBook,kanbanCatalog,serializeResource,prepareAssets,getResourceCatalog,validateSharedResource})` retorna `{dispatch,start,stop}`. Métodos de ciclo não são ações IPC. `cloud` é o transporte já existente; `cloud.ready`, `cloud.enabled`, `cloud.token()`, `cloud.status()` e `cloud.request()` são usados somente no main.

| Ação | Payload | Resultado |
| --- | --- | --- |
| `list` | vazio | organizações próprias/aceitas `{id,name,owner_id,created_at}` |
| `create` | `name` | organização criada; dono deriva de `auth.uid()` |
| `search` | `query` 3–100 caracteres | até 5 `{id,name,nickname}`, nunca e-mail/avatar privado |
| `members` | `orgId` | apenas dono; vínculos com nome/apelido, UUID, status, grants, revision |
| `notifications` | vazio | últimas 100 notificações pessoais com org_name, member_id, revisão/status/grants atuais |
| `read` | `id` da notificação | objeto vazio; só destinatário |
| `invite` | `orgId,recipientId,grants` | vínculo pending; nenhuma autorização antes do aceite |
| `respond` | `id,revision,response: accepted/declined` | vínculo atualizado; só destinatário pendente |
| `permissions` | `orgId,id,revision,grants` | vínculo atualizado; só dono |
| `revoke` | `orgId,id,revision` | vínculo revoked e grants vazios; só dono |
| `catalog` | `orgId` | dono verificado remotamente; catálogo local `{notebooks:[{id,name}],books:[{id,name}],kanban:[{id,name}]}` |
| `resources` | `orgId` | cópias autorizadas `{org_id,module,resource_id,content,revision}`; sem snapshot pessoal |
| `publish` | `orgId,module,resourceId,revision` | cópia criada/atualizada; revisão inicial 0; dono verificado antes de ler dados locais |
| `unpublish` | mesmos IDs/revisão | remove cópia e vínculos de assets; não remove original nem bytes privados |
| `editResource` | mesmos IDs/revisão + `content` | altera apenas cópia, exige grant de escrita e sanitizer injetado; assets novos não são enviados por esta ação |

Convites duplicados pendentes/aceitos são recusados. Reconvite de recusado/revogado volta a pending com nova revisão e exige novo aceite. Alterar grants de um pendente muda a revisão, impedindo aceite silencioso de permissões antigas. Alterações do dono sobre um membro já aceito valem imediatamente e geram aviso. Não há papel de administrador delegado nem transferência de propriedade neste lote.

Grants usam `notebooks`, `books`, `kanban`, `financeiro` e valores `{mode:'none'|'all'|'selected',ids:[],write:boolean}`. `selected` só existe para cadernos e quadros, com 1–500 UUIDs. MEI e módulos pessoais são rejeitados. “Todos” inclui recursos futuros **do espaço**, no caso de cadernos/livros as cópias explicitamente publicadas; nunca novos dados pessoais automaticamente. Livros não levam planos vinculados, página atual, progresso, conclusão ou preferências pessoais de leitura.

Busca por e-mail só faz igualdade exata com e-mail confirmado em Auth e também encontra contas sem linha de perfil público (nome/apelido vazios, UUID visível). Busca por nome/apelido é substring literal, sem curinga SQL, sem paginação, limitada a cinco resultados e uma busca por conta a cada dois segundos no servidor. Retorna apenas identidade pública da conta cadastrada, excluindo anônimos, contas apagadas e bloqueadas. Nome e apelido não comprovam identidade: a UI mostra o UUID antes do envio. Endurecimento operacional contra abuso distribuído pode ser feito no gateway; limite transacional por conta já está no SQL. Não criar listagem geral de perfis nem relaxar RLS de `organon_profiles`.

## Contrato SQL para os outros módulos

```sql
public.organon_can_access_resource(
  p_org_id uuid,
  p_module text,
  p_resource_id uuid default null,
  p_write boolean default false
) returns boolean
```

- Dono da organização acessa os módulos reconhecidos; MEI **sempre** exige esse dono. Não significa que membros possam consultar configurações/relatórios pessoais de MEI derivados das mesmas entradas.
- Outros usuários exigem vínculo `accepted` e grant. `p_write=true` também exige `write=true`. `pending/declined/revoked` não concedem acesso.
- Grant `selected` exige ID do caderno/quadro; passar null não autoriza a listagem de todos. Categorias/marcadores seguem o domínio e, quando necessário, o quadro pai, sem usar null como forma de liberar seleção.
- Valores reconhecidos: `notebooks/books/kanban/financeiro/mei`. Módulos pessoais/outros valores retornam falso.
- Políticas de domínio devem usar SELECT com leitura e INSERT/UPDATE/DELETE com escrita, incluindo USING e WITH CHECK na atualização. Preservar org_id e pai/ID do recurso, e usar CAS também no registro de domínio.
- Helpers privilegiados ficam em `organon_private`, schema não exposto na Data API, search_path vazio, execução PUBLIC revogada. Wrappers públicos são SECURITY INVOKER. Leitura de organizações/vínculos usa helpers sem recursão. Escrita direta de tabelas foi revogada de authenticated; mutações passam pelo RPC fechado `organon_teams`.
- Todos os dados novos têm RLS. Nenhuma conta/permissão legada é importada automaticamente. `organizations(id,name,created_at)` preserva o contrato legado e recebe `owner_id` nullable para mapeamento explícito de organizações existentes.

## Assets, cópias e adaptações já disponíveis

`extractResource(data,module,id)` faz projeção explícita: caderno conserva id/nome/ícone/cor/capa e páginas id/título/data/texto/imagens/documento; livro conserva apenas id/título/formato/hash/tamanho. Não serializa `plans`, notas de planos, Anki, settings, histórico nem chaves extras. Não normaliza/regrava dados pessoais. UUIDs existentes são mantidos.

`createLocalAdapters({cloud,readData,readBook,kanbanCatalog})` é exportado e usado automaticamente quando `readData` é injetado no serviço. `readData()` lê o estado pessoal corrente no main; `readBook(hash)` retorna Buffer por hash validado, sem caminho arbitrário do renderer. `kanbanCatalog({orgId})` deve retornar somente quadros daquele espaço (padrão vazio).

O adapter envia cada imagem de capa/página/documento e arquivo do livro para bucket privado **separado** `organon-shared`, caminho `<orgId>/<module>/<resourceId>/<sha256>`, confirma o hash em duplicatas e conserva o documento rico e textos. A referência vira `{bucket:'organon-shared',object:'...'}`. O original pessoal permanece intacto. Livro requer tamanho/hash exatos. Não gera URL pública, nem usa bucket/snapshot pessoal como fonte de leitura para membros.

SQL valida prefixo/hash, existência do objeto e autorização por cópia. Bucket novo tem limite de 200 MiB; conflito com bucket público aborta. Upload é somente do dono, sem política de overwrite/delete; retirar a cópia retira leitura dos membros. Upload antes de uma falha de CAS pode deixar objeto órfão privado; GC central deve apagar somente objetos sem referência, nunca varrer assets pessoais. Revisar políticas globais de Storage/Realtime que possam conceder acesso amplo: políticas permissivas são aditivas.

## Integração exigida do coordenador

1. Instanciar o serviço no main com CloudSync, `readData` do perfil ativo e `readBook` limitado ao armazenamento existente por hash. Injetar `kanbanCatalog` usando serviço autorizado de quadros. Registrar apenas ações descritas, validar origem IPC como no restante do app e encaminhar `emit` para `api.subscribe('teams', listener)`. Não retornar CloudSync/session/token ao renderer.
2. Carregar `Teams.jsx` no shell com `{api,user,workspace}` e integrar a escolha global do espaço nos demais módulos. O seletor desta página gerencia seu estado interno; a seleção global deve ser responsabilidade do shell. `list` só contém espaços aceitos/próprios, e um convite pendente aparece nas notificações.
3. Nos cadernos/livros, criar catálogo de compartilhados separado do pessoal e consumir `resources`. Resolver referências `{bucket,object}` no main por download autenticado, conferindo SHA-256, devolvendo bytes/URLs locais transitórias ao renderer. Materializar imagens privadas antes de passar pelo validador/editor pessoal que espera data:image. Nunca reutilizar URLs públicas nem gravar objetos privados no snapshot pessoal. Preservar rich text e HTML legado em seus renderizadores seguros.
4. Conectar editor de cópia a `editResource`, injetando `validateSharedResource` que aceita **um** recurso de formato conhecido, preserva IDs e rejeita snapshot/campos pessoais, HTML inseguro e referências de assets fora da cópia. Ausência desse adapter falha explicitamente. Este módulo não altera os editores globais e não promete edição de novos assets por membros; grant de escrita é respeitado pelo servidor para conteúdo e pelos módulos de domínio que o implementarem.
5. Usar revisões retornadas nas mutações; em erro SQLSTATE 40001, reconsultar e pedir que a pessoa reveja antes de reenviar. O serviço sinaliza invalidação e mostra mensagem de conflito; nunca repetir escrita automaticamente com nova revisão.
6. Injetar cliente Realtime **autenticado no main** (tokens não entram no renderer). Ao login/renovação, atualizar autenticação desse cliente e chamar `start()`; no logout/troca de conta/encerramento chamar `stop()` antes de limpar o estado e desinscrever listeners. Canais privados `teams:user:<UUID>` recebem só `invalidate`. SQL emite para dono/destinatário ao mudar vínculo e para dono/membros aceitos ao mudar cópia. `SUBSCRIBED` inicial/reconexão emite `resync`; coordenador e UI devem refazer leituras autorizadas. Sem realtimeClient, `start()` retorna `{available:false}` e chamadas manuais funcionam. Não há promessa de captura de eventos durante desconexão nem fila de escrita offline.
7. Defaults/migração em model: snapshots/backups antigos sem campo de equipes continuam válidos, com nenhuma seleção/cache. Dados autoritativos de equipe **não** entram no snapshot pessoal `organon_sync_state`. Se persistir preferência opcional, usar algo como `teams:{selectedOrgId:null}`; restaurar UUID apenas como preferência e revalidar com `list`, nunca criar vínculo/grant ao importar backup. Não copiar members/grants/session/token como se fossem dados pessoais editáveis. Registrar esse contrato no documento global `docs/DADOS-E-MIGRACOES.md` sob propriedade do coordenador.
8. Exportação/importação: preservar cadernos/livros pessoais existentes exatamente; exportação de compartilhados deve ser explícita por recurso e materializar somente assets autorizados. Importar uma cópia como pessoal exige IDs locais próprios e nenhuma autoridade remota restaurada. Backup/cache antigo de recurso revogado não reconcede permissão: limpar cache por conta/space/revogação. A revogação impede leituras futuras no servidor; não remove cópias que alguém já exportou legitimamente.
9. Coordenar aplicação única do SQL antes de schemas de domínio e revisar os advisors. Aplicar ownership/mapeamentos na migração central sem criar Auth para autores históricos. Não importar roles/policies de origem. Manter a migração de dados reais fora deste módulo.

## Validação e pendências

Verificação essencial realizada: `node --check` do serviço e arquivo de testes; parsing/transformação JSX com `transformWithOxc` do Vite nos três componentes. Tentativa inicial de parser Babel indisponível foi substituída pelo parser já instalado do Vite; nenhum pacote foi instalado. **Testes não executados**, nenhuma validação visual, RLS/Storage/Realtime remoto ou migração foi declarada aprovada.

Comando único para o usuário, sem depender da pasta atual do PowerShell:

```powershell
node --test 'C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\teams.test.js'
```

Verifica matriz, fronteira autenticada, revisões, exclusão de campos pessoais, assets e ciclo Realtime com transporte controlado. Esses testes **não validam o servidor real**. O roteiro SQL permanece preparado para o coordenador executar em Supabase local descartável; não executá-lo em produção. Ainda requer ampliar validação de Storage com duas contas, isolamento de eventos, busca/throttle, conflitos de edição/publicação e importação/exportação na integração real.

- [x] Inventário da UI/APIs de origem e descarte do fluxo SMTP/papéis amplos.
- [x] UI, transporte fechado, contratos SQL, grant granular, convite/aceite/revogação/notificações e cópias privadas preparados.
- [x] Extração por whitelist e adapters de upload/hash implementados no escopo.
- [ ] Execução dos testes unitários pelo usuário e validação SQL local pelo coordenador.
- [ ] Integração de shell/main/preload/model/backups/sync, leitor de assets, sanitizer/editor e seleção global.
- [ ] Aplicação centralizada do SQL e validação real com contas distintas/advisors; provisionamento remoto permanece sob coordenação.
- [ ] Procedimento central para GC de uploads órfãos privados e observabilidade/limite operacional de busca.

Referências consultadas: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [Realtime privado](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes). A tentativa de buscar o índice `changelog.md` retornou tipo de conteúdo não suportado; não foi presumida ausência de breaking changes. SQL preparado requer validação na versão efetiva do ambiente centralizado.
