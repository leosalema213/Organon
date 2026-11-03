# Financeiro, MEI, quadro e compartilhamento — contrato de implementação

Solicitado em 03/11/2026. Lote novo, posterior à 0.5.6. Implementação autorizada; commit/push/Release exigem confirmação de encerramento. Chats distintos compartilham o mesmo checkout e devem respeitar a propriedade de arquivos abaixo. Não reverter alterações de outros chats. Fonte `Z:\financas` somente leitura; não alterar o aplicativo/banco de origem. Não copiar credenciais ou dados pessoais para código, documentos versionados ou fixtures.

## Resultado pedido

- Kanban integrado ao aplicativo base, reproduzindo as opções do Você Controla Aí com o layout/componentes do Organon.
- Financeiro e MEI como adicionais próprios, ausentes na navegação inicial. Preferências → Plugins permite baixar/instalar/remover cada adicional. Não simular download com um simples switch nem importar os adicionais no bundle inicial.
- Financeiro: entradas, gastos, projetados, categorias, filtros, criação/edição/exclusão e operações existentes na origem. MEI: reproduzir exatamente os filtros/cálculos e relatórios da origem, com aritmética monetária exata e limite anual configurado; não presumir teto legal nem atualizar valores por adivinhação.
- Equipes com convites e notificações dentro do app, sem SMTP. Destinatário já cadastrado encontrado por e-mail exato ou busca limitada por nome/apelido; desambiguar e exibir a pessoa antes de convidar. Não liberar lista de e-mails/perfis nem usar e-mail não confirmado como prova de identidade. Convite vinculado ao UUID do destinatário, aceitação/recusa explícita e permissões aplicadas pelo servidor.

## Matriz de compartilhamento

| Recurso | Regra |
| --- | --- |
| Meu dia, planos, progresso, notas, Anki | Pessoais, não compartilháveis neste lote. |
| Cadernos | Nenhum, todos ou IDs de cadernos selecionados. |
| Livros | Nenhum ou todos; catálogo separado de livros compartilhados. |
| Quadros | Nenhum, todos ou IDs de quadros selecionados. |
| Financeiro | Nenhum ou todo o financeiro do espaço. |
| MEI | Pessoal; não conceder permissão de MEI pelo convite. |

"Todos" inclui recursos futuros do escopo. O usuário pode rever permissões e remover acesso. Não compartilhar o snapshot pessoal inteiro para atender um caderno/livro/quadro. O financeiro compartilhado contém os lançamentos financeiros autorizados; as configurações/relatórios pessoais de MEI continuam restritos ao proprietário, mesmo quando derivados de lançamentos usados no financeiro.

## Dados e migração — propriedade da conversa coordenadora

- Origem Supabase `tuvzmqclhaguuouoedmp` (financas); destino `qbkuruzzmxgvkiquacol` (Organon). Autorização e vínculo da conta de destino já confirmados pelo usuário. IDs pessoais e e-mails ficam apenas no relatório local ignorado, nunca hardcoded em migrations/fixtures.
- Migrar somente o domínio do aplicativo: organização, autores históricos, configurações anuais, categorias/lançamentos, quadros/colunas/cartões/marcadores/vínculos e assets referenciados. A tabela sem relação com o produto não faz parte da migração.
- Conservar nomes/campos das entidades de domínio quando possível: `financeiro_types`, `financeiro_entries`, `kanban_boards`, `kanban_lists`, `kanban_cards`, `kanban_tags`, `kanban_card_tags`. O antigo `settings` vira `financeiro_settings`, com proprietário para a configuração de MEI. `org_id` permanece referência de organização/espaço.
- A base de equipe usa `public.organizations` (id/name/created_at compatíveis com a origem, acrescida de `owner_id`), com organizações criadas pelo proprietário e vínculos/permissões próprios. A migração conserva o UUID da organização e dos registros de domínio, sujeito a verificar colisões. Não copiar contas Auth, senhas, sessões, políticas inseguras ou privilégios do sistema antigo.
- Jaqueline permanece como autora histórica. Não criar uma conta Auth nem conceder acesso automático no destino. Preservar `source_created_by`/mapeamento de autores legados, enquanto `created_by` usa a conta de destino válida; não apagar essa distinção.
- Deduplicação de categorias somente dentro da mesma organização, por nome com Unicode normalizado, trim, espaços colapsados e caixa ignorada. Selecionar ID canônico determinístico, remapear referências e guardar todos os IDs/nome/autoria originais em mapa de migração. Não fundir sinônimos nem remover lançamentos por semelhança de data/valor/descrição.
- Reexecução deve ser idempotente por `(source_project, source_table, source_id)`, incluindo as categorias alias. Um manifesto/hashes deve impedir sobrescrita silenciosa de dados já editados no destino. Auditoria por contagens, relações, somas decimais por ano/tipo/MEI e hashes; assets copiados por bytes/hash para Storage privado antes de atualizar referências. Não depender de URLs da origem para a cópia final.
- Exportações brutas, SQL com dados e relatórios privados em `test-output/migration-financas/` (já ignorado pelo Git). Código versionado usa parâmetros e dados sintéticos. Capturar uma leitura consistente e manter a origem intacta. O destino é validado antes de declarar migração concluída.

## API e integração entre chats

- Nenhum access/refresh token nem chave administrativa entra no renderer. O transporte existente permanece no main Electron. O coordenador integra `main.cjs`, `preload.cjs`, `cloud.cjs`, `App.jsx`, `Preferences.jsx`, `model.js`, backups e sincronização; os outros chats não alteram esses arquivos compartilhados.
- Páginas exportam componente padrão com props `{ api, user, workspace }`; `user` é somente identidade pública, `workspace` contém `{id,name,owner_id}` ou null. `api.call(module, action, payload)` retorna Promise; `api.subscribe(module, listener)` retorna unsubscribe. Módulos: `teams`, `kanban`, `financeiro`, `mei`. `payload.orgId` seleciona espaço, mas o servidor valida toda autorização; nunca confiar no renderer para owner/user/role.
- Cada serviço do main exporta `createService({cloud, ...dependencies})`, retornando `{ dispatch(action,payload) }`. `cloud.ready`, `cloud.token()` e `cloud.request(path,options)` são o transporte autenticado existente; garantir entrada de usuário habilitada. A lista de ações/tabelas permitidas deve ser fechada, sem SQL/REST arbitrário exposto ao renderer. Documentar ações e dados retornados no arquivo do módulo.
- Mudanças compartilhadas persistem por registro e são sinalizadas em canal privado Realtime. Reconectar requer buscar o estado autorizado; não presumir entrega de todos os eventos. Concorrência do mesmo registro exige revisão esperada/atualização atômica, sem sobrescrita silenciosa. Não prometer escrita offline compartilhada até haver fila durável e resolução de conflitos. O app pessoal offline continua funcionando.
- Esquemas de domínio dependem das funções de permissão do contrato de equipes. Equipes deve exportar/documentar SQL `organon_can_access_resource(p_org_id uuid, p_module text, p_resource_id uuid default null, p_write boolean default false) returns boolean`; implementação segura, RLS sem recursão/escalada, validando owner ou vínculo aceito + grant. MEI exige owner sempre. Categorias/marcadores seguem o domínio do recurso, sem abrir outras áreas do espaço.
- UI usa `src/Modal.jsx`, `src/PopupMenu.jsx`, `src/RichTextField.jsx` quando aplicável, componentes e escala do Organon, CSS escopado, dark neutro e paletas respeitadas. Não portar Tailwind/roteador/tema globais da origem. Mídia e HTML legados não podem ser perdidos.

## Propriedade dos arquivos

| Chat | Arquivos permitidos |
| --- | --- |
| Coordenador | Integração compartilhada, `scripts/migration-financas-*`, `supabase/modules/financeiro.sql`, relatórios/contratos globais e migração real. |
| Equipes | `src/teams/`, `electron/modules/teams.cjs`, `supabase/modules/teams.sql`, `tests/teams*`, `docs/modulos/EQUIPES.md`. Inclui interface para seleções e serviço de compartilhamento individual, sem editar arquivos globais. |
| Kanban | `src/kanban/`, `electron/modules/kanban.cjs`, `supabase/modules/kanban.sql`, `tests/kanban*`, `docs/modulos/KANBAN.md`. |
| Financeiro | `src/plugins/financeiro/`, `electron/modules/financeiro.cjs`, `tests/financeiro*`, `docs/modulos/FINANCEIRO.md`. Não criar outro schema nem tabelas paralelas; descrever necessidades para o schema coordenado. |
| MEI | `src/plugins/mei/`, `electron/modules/mei.cjs`, `tests/mei*`, `docs/modulos/MEI.md`. Mesmo dataset financeiro, configurações de MEI privadas; serviço pode reutilizar funções puras explicitamente exportadas pelo financeiro, documentando dependência. |
| Plataforma de plugins | `src/plugin-system/`, `electron/plugins.cjs`, `scripts/plugins-*`, `plugins/`, `tests/plugins*`, `docs/modulos/PLUGINS.md`. Não editar package.json, build global ou shell; fornecer instruções de integração ao coordenador. |

Cada chat mantém em seu documento: inventário de comportamentos da origem, contrato/API, arquivos implementados, decisões, testes preparados, limitações/bloqueios e próximos passos. Não executar suítes/E2E: preparar um comando PowerShell absoluto e aguardar execução do usuário. Não aplicar DDL remoto nem migrar dados por conta própria; SQL/revisão e aplicação ficam centralizados. Não alterar versão, criar commit, push ou Release. Não iniciar outro build enquanto o coordenador empacota.
