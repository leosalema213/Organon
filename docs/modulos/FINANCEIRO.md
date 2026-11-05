# Financeiro — adicional Organon

Implementação local de 03/11/2026. Propriedade limitada a `src/plugins/financeiro/`, `electron/modules/financeiro.cjs`, `tests/financeiro*` e este documento. Origem lida sem alterações; nenhuma consulta de dados pessoais, DDL remoto ou migração executada.

## Inventário funcional da origem

Referências: `Z:\financas\src\pages\Financeiro.tsx`, `src/lib/api/entries.ts`, `src/lib/api/types.ts`.

- Tabela de descrição, valor BRL, categoria, natureza e data, mais recentes primeiro. Data legada usa `entryDate ?? createdAt.slice(0,10)`.
- Filtro padrão por mês/ano atual; opções dia e exibir tudo; filtros combinados de categoria e natureza (`entrada`, `gasto`, `projetado`). Limpar restaura modo mês, mantém mês escolhido e remove natureza/categoria.
- Os valores principais mostram entradas confirmadas, gastos e saldo (entradas confirmadas menos gastos). Quando a seleção filtrada inclui lançamentos projetados, os cartões de Entradas e Saldo exibem uma linha secundária com a soma dos projetados ao respectivo valor principal.
- Criar/editar descrição, categoria, valor, natureza, data; checkbox `countForMei` aparece em entradas e é preservado ao mudar natureza. Default novo/legado ausente: true, como o formulário original. Novas datas usam mês selecionado e dia atual, limitado ao fim do mês.
- Criar categoria dentro do formulário, selecionar a criada (ou existente normalizada). Origem não oferece edição/exclusão de categorias nesta página; não foram introduzidas operações destrutivas de categorias.
- Editar pela descrição ou menu compartilhado; excluir com confirmação explícita e revisão esperada.
- Duplicar seleção filtrada: tudo, entradas, gastos ou projetados; destino mês/ano; mantém dia limitado ao último dia do destino, descrição/categoria/valor/natureza/MEI. O rótulo antigo dizia “entradas e gastos”, mas `ambos` também incluía projetados; o rótulo foi esclarecido mantendo o comportamento. Seleção é capturada ao abrir o diálogo para eventos remotos não a mudarem silenciosamente.
- Sem importação de Tailwind, tema ou roteador da origem; Modal e PopupMenu compartilhados, CSS escopado. Descrição original é texto simples e continua preservada como texto.

## Arquivos e integração

- `src/plugins/financeiro/index.jsx`: export default `Financeiro({api,user,workspace})`. Não importar no bundle base. Plataforma empacota esse entrypoint React e seu CSS como plugin baixável com React compartilhado.
- `src/plugins/financeiro/model.js`: funções puras ESM para valores exatos, filtros, totais, datas e normalização. Não dependem de conta/rede.
- `electron/modules/financeiro.cjs`: `createService({cloud,emit?}) -> {dispatch(action,payload)}`. O coordenador registra o serviço no transporte do main e encaminha sinais `emit(event)` para assinantes autorizados. Não há tokens/chaves no renderer.
- `tests/financeiro.test.js`: testes sintéticos de cálculo, filtros, datas, whitelisting, revisões e contrato de transporte.

`api.call('financeiro',action,payload)` é a única ponte usada. `api.subscribe('financeiro',listener)` deve retornar unsubscribe. Evento `{module:'financeiro',orgId,type:'changed'|'reconnected'}` invalida a lista. Reconexão, foco da janela e evento online refazem snapshot autorizado. Nenhum evento substitui validação do servidor. Falha ao reler limpa a lista, inclusive em revogação; troca de identidade/espaço remonta o componente e descarta dados/formulários antigos.

## Contrato de API / SQL que o coordenador precisa fornecer

**As RPCs abaixo são dependência obrigatória e ainda precisam da implementação/aplicação coordenada.** Não há fallback REST com `Number(numeric)`, escrita sem revisão nem armazenamento paralelo. O serviço falha se a resposta não confirmar a escrita.

Transporte fixo via `cloud.ready`, habilitação de entrada, `cloud.token()` e `cloud.request`. Apenas `/rest/v1/rpc/financeiro_snapshot` e `/rest/v1/rpc/financeiro_mutate` são acessíveis. RPC `POST`, parâmetros JSON; sem SQL/endpoint/tabela arbitrários.

`financeiro_snapshot(p_org_id uuid) returns jsonb`:

```js
{ entries: [{ id, orgId, description, value: '123.45', typeId,
  entryType: 'entrada'|'gasto'|'projetado', entryDate: '2026-11-03',
  countForMei: true, createdAt, createdBy, sourceCreatedBy, revision: 1 }],
  types: [{ id, orgId, name, createdBy, sourceCreatedBy }] }
```

Retornar dataset completo autorizado, sem truncamento silencioso no limite padrão PostgREST: agregado JSON único ou paginação consistente interna. `value` deve ser **texto** vindo de `value::text`, inclusive nas respostas JSONB; um numeric JSON já terá perdido precisão no parser JS. Datas/autoria/IDs legados preservados. `revision` inteiro positivo obrigatório; se usar bigint, limitar ao intervalo seguro JS ou revisar o contrato em conjunto antes de usar valores maiores. Todos os campos camelCase acima são consumidos diretamente.

`financeiro_mutate(p_org_id uuid,p_action text,p_payload jsonb) returns jsonb`:

| Ação | p_payload | Resposta |
| --- | --- | --- |
| createEntry | `{requestId,description,value:string,typeId:uuid\|null,entryType,entryDate,countForMei:boolean}` | `{ok:true,entry?:Entry}` |
| updateEntry | `{id,expectedRevision,...campos completos do lançamento}` | `{ok:true,entry?:Entry}` |
| deleteEntry | `{id,expectedRevision}` | `{ok:true}` |
| createType | `{name,normalizedName}` | `{ok:true,type:Type}` (criada ou existente) |
| duplicateEntries | `{requestId,targetMonth:'YYYY-MM',entries:[{id,expectedRevision}]}` | `{ok:true,entries?:Entry[]}` |

Snapshot usa apenas `{orgId}` na ponte; todas as mutações também exigem `orgId`. Máximo duplicado por operação: 1000 registros; caso maior, UI/serviço solicita seleção menor, sem lotes parciais automáticos. Erro concorrente retorna `{conflict:true}` sem alterações ou lança erro SQL; UI mantém rascunho e oferece Atualizar. Reenvio com o mesmo `requestId` deve devolver o resultado anterior, nunca duplicar gravação. UI mantém o ID durante tentativas do formulário/diálogo aberto.

### Requisitos de schema, segurança e transação

- Manter `financeiro_entries`/`financeiro_types`, `org_id`, `created_by`, `source_created_by`, campos originais snake_case e valores **numeric sem estreitar/arrotondar escala legada**. Formulário envia string decimal (ponto ou vírgula convertida para ponto), sem separador de milhar. Números negativos/zero permitidos como na origem; nenhum limite legal MEI presumido.
- Revisão positiva com default 1 em registros migrados; update/delete validam e bloqueiam atomicamente ID+org+revisão. Incremento de revisão é do servidor; nunca aceitar revisão nova/autoria/org alterados pelo renderer. Atualização não substitui `created_by` nem `source_created_by` históricos.
- Verificar sessão e `organon_can_access_resource(p_org_id,'financeiro',null,p_write)` em **todas** as RPCs. Dono ou vínculo aceito + grant do dataset completo; nenhum acesso via apenas `created_by`, nome/e-mail ou UUID conhecido. RLS também nas tabelas e políticas USING/WITH CHECK; impedir escrita direta que contorne revisão/invariantes.
- Categoria do lançamento deve pertencer à mesma organização. `typeId:null` preserva dados legados sem categoria; formulário novo exige selecionar/criar categoria.
- `createType` deve recomputar normalização no servidor (Unicode NFKC, trim, espaços colapsados, caixa pt-BR ignorada), nunca confiar em `normalizedName`. Garantir unicidade concorrente `(org_id,normalized_name)` e retornar o registro canônico existente. Não fundir sinônimos; não apagar lançamentos por semelhança. Migração remapeia aliases com histórico conforme contrato global.
- `duplicateEntries` lê os registros reais sob permissão, confere **todas** as revisões e organizações, deriva valores/autoria do servidor, ajusta data (inclui bissexto) e insere **em uma única transação**. Criado por `auth.uid()`, sem forjar autor histórico da cópia. Qualquer conflito/inacessibilidade aborta o lote inteiro. Pedido repetido é idempotente por usuário/espaço/requestId; registrar também hash do payload para impedir reutilização do ID com conteúdo diferente.
- `createEntry` também usa idempotência; campos `created_by` vêm de `auth.uid()`, `source_created_by` só da migração confiável. Nenhum desses campos é encaminhado do renderer pelo serviço.
- Publicar invalidação em canal Realtime privado somente após confirmação da transação. Canal/read permissions acompanham vínculo/grant atual; não divulgar dataset, configurações ou relatórios pessoais MEI. Host gerencia a conexão e repassa reconexões; este serviço não abre WebSocket próprio.
- MEI deriva do mesmo dataset; não adicionar defaults SQL que convertam flags históricas de false/null, não mudar semântica de entrada/gasto/projetado e não expor `financeiro_settings` pelo snapshot financeiro.
- Integração com exportação/importação/backup e contrato global `DADOS-E-MIGRACOES.md` é do coordenador. Não se grava este dataset no snapshot pessoal para contornar ACL. Backups devem preservar strings decimais, autoria histórica, revisões e IDs; aplicação remota pendente. O usuário precisa ser avisado se o backup pessoal não incluir esses dados remotos.

## Decisões e limites

Aritmética da UI usa BigInt com alinhamento de escala decimal arbitrária; nem totais nem apresentação convertem dinheiro para Number. Escalas maiores que dois dígitos são exibidas por inteiro para evitar ocultar valores legados. Serviço recusa `value` numérico. Pure helpers CJS exportados: `decimal`, `normalizeCategoryName`, `validDate`, `entryPayload`, `commandPayload`, `validateSnapshot`, `newRequestId`; não há soma monetária no main. MEI pode manter seu módulo puro independente; nenhum arquivo MEI foi alterado.

Sem fila durável, não há escrita offline compartilhada nem promessa de cache persistido. O app pessoal offline permanece responsabilidade do shell. Não houve import do plugin no shell/base, alteração de versão ou publicação.

Referência oficial consultada para RPC: [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc). O índice changelog markdown foi solicitado, mas o navegador recusou seu content-type; não foram feitas alterações remotas baseadas em suposição de versão.

## Validação preparada e pendências

Sintaxe conferida diretamente: `node --check` no serviço, modelo e arquivo de testes; JSX analisado por `transformWithOxc` do Vite, sem build nem execução de testes. Não houve validação visual, E2E ou servidor real.

Testes comportamentais executados pelo usuário em 03/11/2026: **8 testes aprovados, 0 falhas**, duração total de 221,5884 ms. Resultado informado neste chat; não é necessário repetir sem alteração relevante. Comando PowerShell utilizado, funciona em qualquer diretório:

```powershell
node --test 'C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\financeiro.test.js'
```

Confere precisão decimal, totais/projetados/MEI, filtros, datas bissextas, normalização de categoria, revisões obrigatórias, payloads sem autoria forjada, RPCs fixas, sessão e tratamento de conflito. São testes locais com transporte sintético: **não validam servidor real**.

- [x] Inventário funcional e implementação UI/serviço/funções puras.
- [x] Testes focados preparados com dados sintéticos.
- [ ] Coordenador implementar e revisar as RPCs exatas acima em `supabase/modules/financeiro.sql`; aplicar somente no fluxo central autorizado.
- [ ] Coordenador registrar serviço/emit/subscription e canal privado Realtime com invalidação após revogação/reconexão.
- [ ] Plataforma gerar pacote React compartilhado do entrypoint, sem incluir no bundle base.
- [x] Usuário executar testes focados e enviar resumo: 8 aprovados, 0 falhas.
- [ ] Conferir visual pelo procedimento combinado, sem dados pessoais em fixtures.
- [ ] Validar servidor real: ACL owner/membro/convidado pendente/revogado; conflitos entre duas sessões; categoria concorrente; idempotência/duplicação atômica; valores textuais de alta precisão; exportação/importação e migração coordenada.
