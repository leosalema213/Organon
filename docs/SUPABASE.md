# Conta opcional e sincronização do Organon

Código de integração incluído na 0.4.9 e reativado na 0.5.6-preview.1 após a validação real descrita abaixo. Projeto dedicado: **Organon**, referência `qbkuruzzmxgvkiquacol`, organização leosalemadev, região São Paulo. O projeto Finanças foi usado somente como origem da migração de domínio em 03/11/2026; o aplicativo usa o Organon.

Em 03/11/2026, o usuário solicitou a retomada da configuração e da sincronização. O provisionamento está resolvido; o diagnóstico de 28/10 permanece abaixo como histórico. As funcionalidades locais continuam disponíveis e os contratos estão registrados em `DADOS-E-MIGRACOES.md`.

A compilação atual usa `enabled: true` em `electron/cloud-config.cjs`: disponibiliza conta e sincronização opcionais. Os arquivos locais, preferências e identificadores legados são preservados. O teste `tests/cloud-ui.cjs` usa rede simulada; `tests/cloud-live.cjs` valida o servidor real em perfis temporários, incluindo a criptografia real do Windows.

## Estado da configuração

### Módulos colaborativos — 0.5.7 em validação

**Resultado mais recente (03/11/2026):** 24 testes focados de backend/equipes/quadro aprovados e `modules-live.cjs` concluído com `ok:true`, no servidor real, pelo usuário. Confirmados os oito grupos: Auth/anonimato, categorias/idempotência/precisão, arquivos/cópias privadas, convite/aceite/seleção, CAS/evento entre contas, reconexão, MEI privado e revogação de dados/Storage mesmo com cache local. A interface integrada já havia passado. As sessões sintéticas foram revogadas e quadros/lançamentos removidos; registros administrativos e objetos sintéticos restantes continuam identificados nos relatórios locais ignorados. Não usar as limitações históricas abaixo como descrição do resultado atual. Downloads públicos do catálogo aguardam Release; checagem dos plugins no preview empacotado também aprovada pelo usuário em `tests/modules-ui.cjs --packaged` (instalação/abertura/remoção, JavaScript/CSS pelo protocolo real e preservação dos dados). Os downloads do GitHub foram simulados nesse teste e serão conferidos após publicar os assets.

Migrations de equipes, Kanban, financeiro, relatórios privados MEI e histórico de migração aplicadas no servidor. As definições atuais ficam em `supabase/modules/`. A migration `organon_financial_exact_decimal_rpc_hardening` alinha valores de precisão arbitrária e concentra as escritas financeiras nas RPCs; as tabelas permanecem somente leitura para clientes autenticados. O MEI exige proprietário mesmo quando o financeiro está compartilhado.

A sincronização pessoal continua em `organon_sync_state`. Equipes, quadros e financeiro usam registros próprios, revisões por registro e canais Broadcast privados com avisos de invalidação; a interface consulta novamente os dados autorizados. Reconexão faz nova leitura. Os módulos colaborativos exigem conexão e não têm fila de escrita offline nem mesclagem de texto simultâneo. Cadernos compartilhados usam rascunho e salvamento explícito com revisão, sem sobrescrever silenciosamente outro editor.

A migração real conferiu 103 lançamentos, 10 categorias canônicas (15 originais), 5 quadros, 15 colunas e 114 cartas. Somas por natureza/ano e critérios MEI coincidiram com a origem. Arquivos foram conferidos por SHA-256 e o reenvio integral foi idempotente. A origem permaneceu intacta. Vínculos e autores históricos foram preservados sem copiar Auth nem conceder acesso automático a antigos membros. Relatórios privados ficam somente em `test-output/migration-financas/`, ignorado pelo Git.

Testes unitários individuais de Kanban, Financeiro, MEI e Plugins passaram no terminal do usuário nos chats dos módulos. O lote integrado de 39 testes de backend, sessão, financeiro, migração e equipes também passou no terminal do usuário. Após corrigir a expectativa de texto da versão instalada, a UI integrada passou: quadro/equipes, edição de caderno preservando o original, instalação, abertura e remoção dos dois plugins pelo protocolo real. A rede desse teste é simulada.

A execução real confirmou Auth, bloqueio anônimo, categorias/idempotência, decimal `1.001`, cálculos MEI e bloqueio das escritas REST diretas. Parou na primeira assinatura privada. Os logs mostraram `MissingPartition` e criação das partições/replicação pelo próprio Realtime na mesma janela. Diagnóstico essencial posterior (`tests/realtime-probe.cjs`), com uma conta sintética nova, confirmou `SUBSCRIBED` no canal privado da própria conta; sessão revogada em seguida. Não houve ampliação de políticas ou alteração de dados pessoais. O teste integrado agora captura o motivo da falha e só aceita negação explícita de autorização no cenário negativo, sem confundir indisponibilidade com isolamento aprovado. Convites, colaboração entre contas, arquivos compartilhados, revogação e reconexão ainda dependem da retomada `tests/modules-check.cjs --resume-live` no terminal do usuário. O catálogo de plugins preparado localmente só estará disponível para download público após a Release autorizada.

A retomada chegou ao convite/notificação, mas a verificação de revisão desatualizada expirou. Os logs mostraram `Revision conflict` repetido a cada segundo: o SQLSTATE `40001`, inadequado para conflito de revisão da aplicação, provocava retries internos do PostgREST. Corrigido para `PT409` nas RPCs de equipes/quadro e nos adapters/testes, sem retirar a checagem de revisão. Migration `organon_revision_conflicts_http_409` aplicada; conferência transacional somente com IDs sintéticos confirmou a exceção `PT409` e terminou em rollback. [Causa e solução oficiais](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions). Não havia chamadas presas na consulta de atividade; nenhum backend foi encerrado. Retomada focada preparada: `tests/modules-check.cjs --resume-conflicts` verifica os dois adapters alterados e depois o servidor real, preservando a aprovação da UI. O preview empacotado anterior precisa ser regenerado após essa correção de backend, antes de entrega/publicação.

Os 17 testes dos adapters corrigidos passaram no terminal do usuário. No servidor, publicação/download íntegro de PDF e caderno com imagem, cache sem alterar dados pessoais, convite pendente/aceite e acesso somente ao quadro escolhido também passaram. A execução recebeu o evento privado, mas a expectativa recusou o UUID `id` acrescentado pelo Realtime. Inspeção de `realtime.send` no servidor confirmou essa inclusão automática. O teste foi corrigido em todos os pontos (convite, quadro, reconexão e revogação): valida o UUID e os campos de domínio exatos, sem aceitar conteúdo extra. A filtragem do processo principal continua excluindo payload remoto/UUID da mensagem antes de notificar o renderer. Retomada necessária somente do servidor real; os 17 testes e UI permanecem aprovados.

A execução seguinte confirmou também CAS, evento privado entre contas, recuperação após desconexão/reconexão e financeiro compartilhado mantendo MEI privado. Parou na leitura direta de um URL Storage após revogação. O membro estava revogado, a consulta RLS não via objetos, e os últimos downloads chegados ao Storage eram anteriores à revogação: resposta em cache do CDN, comportamento [documentado pelo Supabase](https://supabase.com/kb/troubleshooting/storage-private-bucket-files-still-accessible-after-remove-access-or-logout). Uploads compartilhados/quadro agora usam `Cache-Control: max-age=0`; downloads autenticados usam nonce de cache novo por requisição e cabeçalhos de revalidação, mantendo verificações de autorização antes/depois e integridade dos arquivos. O teste continua exigindo recusa em uma consulta nova ao Storage, não aceita HTTP 200 como aprovação de revogação.

Verificação essencial `tests/storage-revocation-probe.cjs` executada com duas contas sintéticas e um arquivo: acesso permitido antes, bloqueado após revogar (HTTP 400, CDN `DYNAMIC`), inclusive URL anterior no arquivo com cache zero. Sessões encerradas e cópia despublicada; IDs/objeto sintéticos registrados em `test-output/storage-revocation/`. Sem DDL nem dados pessoais. URLs antigos já armazenados em caches externos e bytes entregues antes da revogação não podem ser apagados remotamente; cabeçalhos de upload novos não reescrevem metadados de arquivos antigos automaticamente. Retomada focada: `tests/modules-check.cjs --resume-storage`, sem repetir a UI aprovada. A integração completa ainda aguarda esse resultado.

### Ajustes da prévia 2 — validados em 03/11/2026

- Cadastro/login e primeiro envio são operações separadas: a modal é liberada após autenticar e proteger a sessão; o envio começa em segundo plano, com indicação de etapas/quantidade de arquivos. O app continua utilizável durante a sincronização.
- Sidebar e cabeçalho distinguem conta conectada, sincronização, pendência, conflito e erro; o modo sem conta mantém a identificação local. O perfil permite nome, apelido e foto, com cache ligado ao UUID da sessão.
- `supabase/profile.sql` aplicado como migration `organon_account_profiles`: perfis independentes de `organon_sync_state`, com políticas de proprietário. Consulta estrutural confirmou RLS ativo, acesso anônimo negado e quatro políticas. O advisor não apontou problemas na nova tabela; informou proteção contra senhas vazadas desativada no Auth, configuração não alterada neste lote ([referência](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).
- Validação no terminal do usuário: 13 testes de dados/controlador passaram, zero falhas, e o build Vite concluiu. O teste de interface chegou ao fim do fluxo e precisou corrigir a busca textual de Dados locais após logout; a retomada `--resume-account` aprovou cadastro separado do upload lento, progresso, nome/apelido, foto/remoção e saída da conta, com rede simulada. Em seguida, o teste remoto passou: execução `13bcbc41-c859-4d9b-a296-2cd601e6b78b` em `test-output/cloud-live-audit.json`, incluindo nome/apelido/foto privados, atualização em outro perfil e cache após reabertura, além das verificações de arquivos, revisão, sessão e RLS. Nenhum dado pessoal foi usado nos testes.
- Conferidos snapshots, perfis, objetos e sessões zerados nas duas contas sintéticas dessa execução. A remoção administrativa das contas por ID/e-mail exatos está pendente: o conector retornou confirmação expirada em duas tentativas; não repetir sem nova ação do usuário. Contas: `a342fd25-c70e-4821-b44b-4210f2891947` e `865dfda6-a7d1-4276-9fcd-2776846ce114`, ambas com prefixo `organon-sync-test-13bcbc41-c859-4d9b-a296-2cd601e6b78b-`. A prévia local 0.5.6-preview.2 está em preparação, sem commit ou publicação.
- A futura colaboração com times/kanban precisa de tabelas por recurso e canais privados Realtime, além da cópia pessoal. Proposta e limites em `COLABORACAO-E-TIMES.md`; nenhuma tabela de time/quadro foi criada.
- Instalador `release/0.5.6-preview.2/Organon-Instalar.exe` gerado com sucesso: manifesto completo de 218 arquivos conferido por tamanho/SHA-256. A inspeção focada `tests/packaged-startup.cjs` abriu o executável real dessa versão em perfil temporário e confirmou Meu dia, conta ativada e ausência de falhas de carregamento/erros JavaScript. Mantidas as compilações locais preview.2 e preview.1; nenhum commit ou publicação efetuado.
- Final 0.5.6 preparada após o aceite da prévia: versão promovida pelo script oficial, 218 arquivos conferidos no ASAR, instalador e alias de compatibilidade com checksums SHA-256, e abertura do executável real confirmada em perfil temporário, com conta ativada e sem erros. As verificações funcionais aprovadas da prévia 2 foram reaproveitadas. Mantidas localmente 0.5.6 e 0.5.6-preview.2; a publicação segue a confirmação de encerramento exigida em `AGENTS.md`.

### Retomada em 03/11/2026

- Projeto confirmado como `ACTIVE_HEALTHY`; banco e API acessíveis. Tabelas públicas, buckets e contas estavam vazios antes da configuração.
- `supabase/schema.sql` aplicado somente ao Organon, pela migration remota `organon_cloud_sync`: tabela com RLS por proprietário, RPC com revisão esperada e bucket privado. Chave publicável e URL conferidas com o conector; nenhuma chave administrativa incluída no cliente.
- Advisors de segurança e desempenho retornaram listas vazias após a aplicação. A consulta estrutural confere permissões/políticas; isso não substitui a prova de isolamento pela API com usuários autenticados.
- API `/auth/v1/settings` inicialmente respondeu com `mailer_autoconfirm: false`. O usuário solicitou cadastro imediato para uso interno, amigos e família e fez o ajuste no painel. O teste real confirmou `mailer_autoconfirm: true` e criação de sessão imediata no cadastro.
- Transporte de livros e mídia Anki implementado em `electron/cloud-files.cjs`, usando partes de até 4 MiB e manifesto versionado dentro do JSONB; upload, download íntegro e backup portátil aprovados no teste real. Não há envio parcial apresentado como backup completo.
- `tests/cloud-sync.cjs` executado com sucesso no terminal do usuário em 03/11/2026: **11 testes passaram, zero falhas**, build Vite concluído e prova real via Electron com duas contas sintéticas. Relatório `test-output/cloud-live-audit.json`, execução `4de49387-7b12-40c9-8aa4-8f5d5446d231`: cadastro, login, RLS de banco/Storage, conflito explícito, rejeição de revisão desatualizada, arquivos, backup, reabertura com DPAPI e refresh. Nenhum dado pessoal foi usado ou enviado nesta configuração.
- O teste real remove os snapshots e objetos das próprias contas sintéticas, revoga suas sessões e apaga somente seu diretório temporário. Os IDs/e-mails ficam em `test-output/cloud-live-accounts.json` para posterior remoção administrativa das contas de teste. Senhas/tokens não são escritos no relatório. Falha na limpeza é registrada e exige conferência.
- Após o teste, conferidos snapshots, objetos e sessões zerados nas duas contas sintéticas; ambas removidas administrativamente por ID e e-mail exatos. Conexão ativada no código; instalador local `release/0.5.6-preview.1/Organon-Instalar.exe` gerado com sucesso. Hook de empacotamento verificou os 218 arquivos do build por tamanho e SHA-256. `tests/packaged-startup.cjs` confirmou o executável real empacotado, conta ativada e Meu dia carregado, sem erros JavaScript/requisições de arquivos, em perfil temporário. Mantidas somente as compilações locais 0.5.6-preview.1 e 0.5.5. Não houve commit nem publicação nesta retomada.

### Histórico anterior

Em 28/10/2026, o projeto remoto permanecia inicializando e a integração retornava “Database is possibly not accessible at the moment”. O esquema estava preparado, mas ainda não aplicado nem validado no servidor. Os testes então usavam serviço simulado e não comprovavam funcionamento da nuvem real.

### Diagnóstico do provisionamento em 28/10, por volta de 14h48 (São Paulo)

- Projeto criado às 11h19 de São Paulo (14h19 UTC), ainda em `COMING_UP` após aproximadamente 3h30.
- Logs de Storage: `TenantNotFound`, `Missing tenant config for tenant qbkuruzzmxgvkiquacol`, HTTP 400 no endpoint interno `/tenants/qbkuruzzmxgvkiquacol/health`, requisitado pelo serviço de gestão do próprio Supabase.
- Logs de Realtime: `TenantNotFound` para a mesma referência. A consulta de logs disponível não retornou registros de Postgres/Auth, portanto não permite concluir a causa inicial da falha.
- Consulta somente de leitura `select 1` continua retornando `Database is possibly not accessible at the moment`. O advisor de segurança retornou lista vazia; isso não comprova que os serviços estejam saudáveis.
- URL oficial confirmada pela integração: `https://qbkuruzzmxgvkiquacol.supabase.co`. Na consulta DNS local, `supabase.com` resolve normalmente, enquanto o host do projeto retorna `ENOTFOUND`.
- O [painel geral do Supabase](https://status.supabase.com) informava operação normal, o que não exclui falha isolada deste projeto.

As evidências apontam para provisionamento incompleto na infraestrutura do Supabase. Não foi aplicada configuração de tabelas, RLS ou buckets pelo Organon; essas alterações não explicam os erros observados. A causa raiz do travamento ainda precisa ser confirmada pelo provedor. Nenhum reinício, pausa, exclusão ou recriação foi executado na investigação.

Texto preparado para [abrir chamado](https://supabase.com/support), sem envio automático:

```text
Subject: New project stuck in COMING_UP — tenant configuration missing
Project ref: qbkuruzzmxgvkiquacol
Organization: leosalemadev | Region: sa-east-1 | Plan: Free
Created: 2026-10-28 14:19:34 UTC
Still COMING_UP after more than 3 hours. No application schema or data has been deployed.
Storage health checks return HTTP 400 TenantNotFound: Missing tenant config for tenant qbkuruzzmxgvkiquacol.
Realtime also reports TenantNotFound. Database queries are unavailable.
The official project API hostname fails DNS resolution locally (ENOTFOUND), while supabase.com resolves normally.
Please investigate and complete provisioning for this project.
```

## Experiência

- Ao abrir pela primeira vez após receber esta versão, aparece uma tela com a marca, Entrar, Criar conta e Continuar offline.
- A escolha é lembrada neste computador em `cloud-state.json`. Não reaparece a cada abertura; o acesso permanece em Preferências → Conta.
- Conta é opcional. Sem conta, o aplicativo continua salvando no mesmo `compasso.json`, sem enviar conteúdo ao Supabase.
- Entrar em uma conta vazia vincula a ela os dados existentes deste computador, sem criar um perfil local vazio.
- Se a conta já tem uma cópia diferente, a sincronização pede uma escolha. Não mescla nem substitui automaticamente duas cópias diferentes.
- Sair da conta conserva o conteúdo local. Se outra conta entrar no mesmo perfil Windows, o app exige uma escolha antes de vincular esses dados à nova conta. Para dados pessoais separados no mesmo computador, preferir perfis Windows separados.
- Não há recuperação de senha por e-mail nesta entrega; isso depende de configurar SMTP e o retorno ao aplicativo.

## Persistência e sincronização

O arquivo local continua sendo a fonte de trabalho. A gravação automática não faz requisições de sincronização. Envio é tentado ao entrar/abrir com sessão, ao fechar e durante o uso após 24 horas do último sucesso quando há alterações, além do botão Sincronizar agora.

O app compara hashes e revisões antes de enviar. Documentos e metadados vão para `public.organon_sync_state`; imagens ficam em um bucket privado `organon-assets`, em caminhos `<user_id>/<sha256>`. Uma imagem já presente não é enviada novamente. A transação `organon_commit_snapshot` valida a revisão esperada para impedir que dois computadores sobrescrevam silenciosamente a mesma revisão. Cada conta só acessa seus próprios registros e arquivos pelas políticas RLS.

Livros (até 200 MiB) e mídia Anki (até 32 MiB) preservam os formatos e verificadores locais. Seus binários são divididos em partes imutáveis de até 4 MiB, enviadas como `application/octet-stream` no mesmo bucket privado e namespace por usuário. O campo de transporte `organonFiles` versão 1 descreve tamanhos e hashes das partes; é retirado antes da restauração do documento. O envio confirma a revisão apenas depois de todos os arquivos; interrupções reaproveitam as partes já enviadas. Downloads verificam partes, tamanho, hash integral e assinatura do arquivo, e instalam binários por arquivo temporário/rename antes de devolver o documento para validação/salvamento. Miniaturas continuam sendo caches locais. Limites totais de armazenamento/tráfego do plano Supabase continuam aplicáveis; o cliente não garante espaço ilimitado. A divisão evita depender de um upload individual de livro acima do limite do plano, mas não reduz o volume total.

Hash de documentos usa chaves ordenadas, pois JSONB pode mudar a ordem das propriedades. Conteúdo recebido e imagens passam por verificação de integridade. Ao trazer a nuvem, o estado é validado pelo mesmo modelo usado pelo importador de backups e o estado local anterior é preservado em `recovery/before-cloud-<data>.json` dentro do perfil. A confirmação da revisão só ocorre após salvar o conteúdo recebido.

Não há sincronização colaborativa nem mesclagem por parágrafo. Nesta entrega há uma cópia atual por conta; confirmar Usar dados deste computador substitui explicitamente a cópia atual remota. Continue mantendo backups exportados independentes. Imagens antigas que deixam de ser referenciadas não são apagadas automaticamente do Storage; isso evita remover conteúdo de um envio em andamento, mas exige acompanhar o armazenamento e desenhar limpeza posteriormente.

Falha de rede mantém a edição local e a pendência. A próxima abertura tenta novamente. Fechar tenta salvar o timer pausado e terminar imagens pendentes, depois concede até cinco segundos para sincronizar. Encerramento forçado/queda de energia não garante envio; os dados locais salvos são retomados depois. O app tem um limite de segurança para não permanecer bloqueado indefinidamente ao fechar.

## Autenticação e credenciais

Login com e-mail/senha usa os endpoints Auth do Supabase no processo principal Electron. O renderer recebe somente estado público da conta, nunca access/refresh tokens. A senha é enviada para autenticação e não é gravada. Sessões são protegidas via `safeStorage` assíncrono/DPAPI no Windows em `cloud-session.enc`, separado do JSON e dos backups. Após copiar dados para outro usuário/computador, entre novamente. O app não usa armazenamento de sessão em texto puro se a proteção estiver indisponível.

`electron/cloud-config.cjs` contém apenas a URL e a chave publicável do projeto. Chave publicável não concede acesso administrativo; isolamento depende de RLS. Não incluir chaves secretas/service_role no aplicativo. Cadastro sem confirmação depende da opção Confirm email desativada no painel do projeto, conforme solicitado pelo usuário.

## Otimização de imagens

Arquivos novos, colagens, capas e rabiscos usam `src/images.js` e `src/image-worker.js`: fila de uma imagem por vez, codificação em worker e limite de saída de 1 MiB. Entradas PNG/JPEG/WebP de até 20 MiB. Imagens menores que 160 KiB são mantidas; demais tentam WebP, ajustando qualidade e resolução sem aumentar a imagem. Transparência e proporção são preservadas; o algoritmo pode reduzir a resolução para atingir a meta. O resultado nunca substitui um original por uma codificação maior.

O resultado é salvo no documento. Exportar ou sincronizar não recodifica essas imagens. Imagens antigas não são migradas ou comprimidas automaticamente para evitar alteração visual irreversível. O backup local continua completo, com imagens embutidas; a separação dos arquivos existe somente no transporte/armazenamento da nuvem.

O usuário recebe Preparando imagem enquanto a fila trabalha. Exportação aguarda a fila, e o fechamento normal aguarda seu término antes de salvar. Teste sintético de 2400×1400 pixels: **9.637.963 → 874.816 bytes**, abaixo de 1 MiB; não é uma taxa prometida para qualquer foto/print.

## Validação local

- `npm test`: cenários do modelo e testes do controlador com serviço simulado, incluindo deduplicação, igualdade de conteúdo, retomada offline, conflito de revisões, troca de conta e proteção contra sessão em texto puro.
- `npm run test:cloud`: interface Electron em perfil temporário, escolha offline lembrada após reinício, cadastro com serviço simulado, vínculo de conteúdo existente, criptografia real do Windows, saída da conta e compressão no worker, incluindo fechamento durante processamento.
- `test-output/cloud-ui-audit.json`: resultado, natureza simulada da rede e tamanhos medidos. Capturas: `account-welcome.png`, `account-connected.png`, `image-compressed.png`.
- As suítes existentes continuam usando perfis temporários. `--skip-account-prompt` só é aceito como atalho de teste em perfil isolado; o teste de conta não usa esse atalho.

Nenhum dado do perfil pessoal foi enviado em testes. A publicação do aplicativo offline não ativa a integração remota.
