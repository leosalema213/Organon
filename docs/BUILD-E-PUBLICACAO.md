# Build de preview e publicação automática

## Publicação 0.8.1 conferida — 11/11/2026

- Preview `0.8.1-preview.1` validado pelo usuário e promoção/publicação explicitamente autorizadas. Commit aprovado `41028473a87f7903473e54e7653bbd33b5ef182f`, com `release-approval.json`, enviado à main.
- [CI 43128888738](https://github.com/leosalema213/Organon/actions/runs/43128888738) concluiu gate, build e publicação com sucesso. Final gerada pelo CI com ASAR, abertura isolada e checksums, sem publicador local concorrente.
- Release `v0.8.1` pública em [Organon](https://github.com/leosalema213/Organon/releases/tag/v0.8.1) e [app-estudos](https://github.com/leosalema213/app-estudos/releases/tag/v0.8.1). Tags apontam ao commit aprovado; instaladores Organon/Compasso nos dois canais têm 139939426 bytes e SHA-256 `65c4e17aff7701eea7219d19f0833841d2e8b592ad0f7831c87915fc619c9e8d`, conferido contra digests e checksums públicos.
- AppUpdates real confirmou oferta de `0.8.1` para `0.8.0` e `0.8.1-preview.1` nos dois repositórios. Relatórios locais ignorados: `.organon-build/publication-0.8.1.json` e `.organon-build/publication-0.8.1-status.json`. Resultados funcionais aprovados reaproveitados; dados pessoais preservados e nenhuma alteração remota de banco.

## Correção da digitação no quadro — 0.8.1-preview.1

- Lote encerrado pelo usuário em 11/11/2026, com pedido de preview e publicação. Cinco testes do provedor ortográfico e cenário isolado com dois retângulos, flecha, texto gradual com acentos, gravação e reabertura aprovados no terminal do usuário; sugestão/substituição real em português também conferida pelo agente. Resultados reaproveitados.
- `npm run preview` concluiu `0.8.1-preview.1`: 577 arquivos do ASAR verificados por tamanho/SHA-256, executável real aberto em perfil temporário com conta ativada e sem erros de carregamento/JavaScript, checksums e retenção das duas compilações locais concluídos. Log `.organon-build/2026-11-12T00-35-02-944Z-preview-23436.log`; recibo em `release/0.8.1-preview.1/build-report.json`.
- Instalador com SHA-256 `853ea57de6a873dd211f7a3c1e04cabab08e39eec35e8ef78b287e0853328fe4`. Mantidos `0.8.1-preview.1` e `0.8.0-preview.2`. Preview validado pelo usuário, com autorização explícita para subir. Promoção oficial para `0.8.1` concluída com `release-approval.json`, vinculando fontes e instalador aprovados. Commit/push preparados para o CI gerar a final e publicar os mesmos bytes nos dois canais; sem publicador local concorrente.

## Publicação 0.8.0 conferida — 11/11/2026

- Após aceite explícito de `0.8.0-preview.2`, promoção oficial com `release-approval.json` e push do commit `b1623f1cd754ae9727e3fd05cb4d04c1242e659d` à main.
- [Execução 43026443606](https://github.com/leosalema213/Organon/actions/runs/43026443606) concluída com gate, build e publicação aprovados. Instalador estável gerado no CI com ASAR, abertura isolada e checksums; nenhum publicador local concorrente.
- `v0.8.0` pública em [Organon](https://github.com/leosalema213/Organon/releases/tag/v0.8.0) e [app-estudos](https://github.com/leosalema213/app-estudos/releases/tag/v0.8.0). Ambas as tags apontam ao commit aprovado. Os quatro assets de instalação (Organon/Compasso nos dois canais) têm 139939470 bytes e o mesmo SHA-256 `696002cde2840787ea8c17e9f7908921279e588d5b2ef2722893691e612e94b9`, conferido contra o digest do GitHub e os checksums públicos.
- Consulta independente com o AppUpdates real confirmou a oferta de `0.8.0` para `0.7.9` e `0.8.0-preview.2` nos dois repositórios. Relatório local ignorado: `.organon-build/publication-0.8.0.json`; andamento do CI em `.organon-build/publication-0.8.0-status.json`.
- Os testes locais aprovados foram reaproveitados. Esta publicação não aplica o SQL de compatibilidade nem comprova a colaboração com contas Supabase reais; essas pendências permanecem registradas no contrato de dados.

## Uso diário

Execute no PowerShell (inclusive em `C:\WINDOWS\system32`):

```powershell
npm --prefix 'C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop' run preview
```

O comando consulta a última Release pública, avança pelo script oficial de versões
(PATCH 0..9), compila o frontend e os recursos offline, usa o Electron local quando
disponível, gera NSIS sem publicar, verifica todos os arquivos do manifesto no ASAR,
abre o executável real em perfil temporário, gera SHA-256 e o alias Compasso e
mantém somente a compilação atual e a anterior. Não usa o perfil pessoal nem
executa suítes funcionais/E2E. Reaproveite os testes funcionais já aprovados.

A saída contém uma linha por etapa e, ao terminar, versão, instalador e caminho do
log. stdout/stderr completos ficam em `.organon-build/*.log`. Não é necessário
consultar o processo a cada poucos segundos; acompanhe a mesma execução até sua
conclusão, com esperas maiores e atualizações somente quando houver mudança.
Rede/NSIS e a inspeção do executável precisam das permissões normais do Windows;
falhas encerram o comando e preservam o log.

Prompt curto reutilizável:

> Gere o próximo preview com `npm run preview`. Reaproveite testes aprovados, não
> publique. Acompanhe a execução sem consultas frequentes e entregue somente a
> versão, o link do instalador e o resultado; em falha, informe a etapa e o log.

## Falhas, concorrência e retomada

- `npm run preview -- --resume` retoma apenas um preview **incompleto**, com a
  mesma versão e as mesmas fontes. Recompila e revalida todas as etapas: não
  confia em um ASAR/instalador parcial. Um preview concluído nunca é recompilado
  com essa opção; `dist` também recusa sobrescrever uma compilação concluída.
  Execute sem `--resume` para obter um identificador novo.
- A reserva de versões em `.organon-build/previews.json` sobrevive à limpeza de
  `release/`; não apague essa pasta para resolver falhas. Também são respeitados
  os diretórios existentes e tags. Não compartilhe previews incompletos.
- `build`, `dist`, `dist:portable`, `preview`, `dist:stable`, os comandos de versão
  e a publicação compartilham `.organon-build/lock.json`. Não execute Vite,
  electron-builder ou scripts internos diretamente em paralelo com eles.
- Uma interrupção abrupta deixa o bloqueio para inspeção. Feche os processos de
  build e seus descendentes antes de usar `npm run preview -- --resume --recover-lock`.
  A recuperação recusa PIDs registrados ainda vivos. Não remova o lock manualmente
  enquanto compiladores, empacotadores ou o executável de teste estiverem abertos.
- Alteração nas fontes durante a compilação recusa a entrega. Documentação e
  testes não entram no hash das fontes distribuídas; pacote/lock entram com
  somente os campos da versão raiz neutralizados. Arquivos binários são
  preservados byte a byte e finais de linha de textos são normalizados.

## Aceite, promoção e gatilho de produção

Ao finalizar ajustes e testes, pergunte se há mais pedidos. Depois do encerramento
do lote, gere o preview. **Somente após o usuário validar esse preview e autorizar
subir**, execute `npm run version:final -- --approved-preview`. A opção registra a
declaração de aceite: não representa aprovação automática nem deve ser usada
sem a autorização. O comando exige o recibo de build concluído e o SHA-256 do
instalador aprovado, promove pacote/lock/changelog e grava `release-approval.json`.

Inclua esse registro no commit aprovado e envie à main. Não é necessário gerar a
final localmente: o GitHub fará isso. O workflow só é disparado por alterações em
pacote/lock/registro; seu gate compara a versão anterior do push, recusa previews,
fontes diferentes das aprovadas, versões fora da sequência e registros ausentes.
A versão 0.7.7 já publicada não é republicada ao instalar esta automação.
O registro é uma evidência de processo, não uma assinatura do usuário; proteja a
main contra mudanças não aprovadas. A autorização de outro lote não é válida.

O build Windows executa a mesma inspeção de ASAR e abertura isolada. Somente o job
de publicação recebe o token; ele baixa os bytes originais guardados como artefato
e publica primeiro no legado e depois no principal, com os mesmos instaladores,
aliases, SHA-256 e catálogo assinado. Consulta então os dois canais públicos e
exercita o AppUpdates real usando um preview da mesma base. Previews não entram
no canal; a versão final continua sendo oferecida às instalações antigas e aos
previews da mesma base. Nenhum commit de versão é criado pelo workflow.

## Configuração única no GitHub

No repositório **leosalema213/Organon**:

1. Habilite Actions. Crie o ambiente `production` restrito à branch `main` e
   configure as proteções de branch/PR conforme a aprovação do proprietário.
   Revisores obrigatórios no ambiente são opcionais: acrescentam uma confirmação
   no GitHub; sem eles, o commit com o registro aprovado é o gatilho automático.
2. No ambiente, crie o secret **ORGANON_RELEASE_TOKEN**, um token fine-grained
   limitado aos repositórios `Organon` e `app-estudos`, com **Contents: read/write**.
   **Workflows: read/write** também é necessário para espelhar commits que alteram
   `.github/workflows/` no legado. Metadata read é implícita. A conta precisa poder
   enviar a main ao legado; não conceda bypass de proteção sem necessidade.
   O `GITHUB_TOKEN` padrão tem somente Contents read e não publica no outro repo.
3. Mantenha ambos os repositórios existentes, com a mesma visibilidade e histórico
   compatível. Não faça push independente/divergente no legado. Lá o workflow é
   ignorado pelo filtro de repositório; pode-se desabilitar Actions no legado.
4. Antes da primeira promoção, execute os testes focados documentados abaixo.
   Confirme o primeiro build/publicação real depois do aceite do próximo preview.
   Em 10/11/2026, Actions foi confirmado habilitado e o ambiente `production` foi
   criado via API, restrito à branch `main`, sem revisores adicionais. O cadastro
   do token específico e a primeira execução foram concluídos no mesmo dia;
   consulte o resultado da publicação abaixo.

O token fica somente no ambiente do job/processo Git, sem URL autenticada,
argumento de terminal, arquivo de credenciais ou chave privada de plugins.
O catálogo público é baixado, sua assinatura e os pacotes são validados e os bytes
originais são reutilizados. Catálogo expirado, incompatível ou alteração nas fontes
dos plugins bloqueia a publicação automática; nesse caso use primeiro o fluxo de
assinatura de `docs/modulos/PLUGINS.md`. Não gere outra chave para contornar isso.

## Recuperação de CI/CD

Há uma única execução de produção por vez (`cancel-in-progress: false`), sem
cancelar um upload em curso. Evite novos pushes à main enquanto a versão aprovada
estiver sendo publicada: o publicador recusa HEAD diferente de origin/main.
Não há gatilho por tag/Release, e o espelho não executa jobs de publicação.

Após falha no build, use **Re-run failed jobs**. Após falha de upload ou de consulta
do canal, reexecute **somente os jobs com falha**: o job publish reutiliza o
artefato `installer-<run_id>` por até 30 dias e retoma drafts/assets idênticos.
Não use Re-run all jobs para reconstruir um instalador parcialmente publicado:
NSIS pode gerar bytes diferentes. Assets divergentes são recusados e nunca
substituídos silenciosamente. A publicação legado primeiro deixa esse canal
funcional mesmo se o principal falhar; a retomada completa o principal.

`workflow_dispatch` na main permite iniciar uma versão aprovada cujo push não
disparou o workflow. Não serve para substituir os bytes de uma publicação parcial
nem para republicar versões públicas. Com artefatos expirados ou divergência de
assets, investigue o estado dos drafts antes de qualquer alteração; nunca apague
uma Release pública para refazer o build. Preserve o instalador original.

Logs de build são artefatos separados e a publicação deixa os detalhes no log do
job e um resumo curto na execução. Não é preciso copiar logs completos de sucesso
para o chat. O fallback local continua disponível: após aprovação, `npm run
dist:stable` e `npm run release -- --reuse-plugin-catalog`, sem competir com o CI.

## Validação focada no terminal do usuário

```powershell
node --test 'C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\release-automation.test.js' 'C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop\tests\versions.test.js'
```

Esses testes verificam bloqueio/recuperação, identidade das fontes e o vínculo da
aprovação com o preview, além dos gates de versão/repositório/publicação repetida,
sem build, dados pessoais ou publicação. O primeiro uso
de `preview` validará também empacotamento e abertura reais. Testes sintéticos não
comprovam credenciais, proteções ou publicação no GitHub real.

Resultado informado pelo usuário em 10/11/2026: **9 testes passaram, zero falhas**
(`release-automation.test.js` e `versions.test.js`). Reaproveitar essa validação
enquanto não houver mudança relevante. Avisos LF/CRLF ocorreram nas fixtures Git
temporárias; mensagens sobre a versão 0.7.8 eram cenários sintéticos, sem publicação.
Após o encerramento do lote pelo usuário, `npm run preview` gerou
**0.7.8-preview.1** em 10/11/2026. A primeira tentativa falhou na consulta de rede,
antes de alterar a versão; a execução com as permissões de rede/NSIS concluiu o
fluxo completo. O ASAR teve 228 arquivos conferidos por tamanho e SHA-256; o
executável real abriu Meu dia com conta ativada, sem falhas de carregamento nem
erros JavaScript, em perfil temporário. Checksums e alias Compasso foram gerados.
Retenção conferida: `0.7.8-preview.1` e `0.7.7`. Log completo em
`.organon-build/2026-11-10T20-43-11-182Z-preview-15704.log`; recibo em
`release/0.7.8-preview.1/build-report.json`. Os nove testes aprovados foram
reaproveitados, sem nova suíte funcional. Na entrega do preview, a validação do
instalador pelo usuário e a configuração/execução do CI ainda estavam pendentes;
nenhum commit, push ou Release deste lote havia sido realizado naquele momento.

O usuário aprovou explicitamente o preview e autorizou configurar a automação e
publicar a final para testar o fluxo. `npm run version:final -- --approved-preview`
promoveu pacote/lock/changelog para **0.7.8** e gerou `release-approval.json`, com
as fontes e o SHA-256 do preview aprovado. A final foi compilada pelo Actions;
o instalador estável não foi entregue como teste. A autenticação Git local
administrou o ambiente e enviou o commit; a publicação no CI usou o token
fine-grained cadastrado pelo usuário, dedicado aos dois repositórios, com
Contents/Workflows write.

## Primeira publicação automática validada — 10/11/2026

- Secret `ORGANON_RELEASE_TOKEN` cadastrado pelo usuário no ambiente `production`.
  O push do commit `4684d4ec5ec7d88523342754bba635ef399449d1` à main iniciou
  [a execução 42899475120](https://github.com/leosalema213/Organon/actions/runs/42899475120).
- Gate e build concluídos com sucesso no GitHub, incluindo manifesto/ASAR,
  abertura real em perfil temporário e checksums. O primeiro job de publicação
  parou com 403 no push para `app-estudos`, antes de criar as Releases. O usuário
  corrigiu as permissões do mesmo token; somente os jobs com falha foram retomados.
  O instalador original foi reutilizado, sem recompilação, e a segunda tentativa
  concluiu com sucesso.
- `v0.7.8` pública em [Organon](https://github.com/leosalema213/Organon/releases/tag/v0.7.8)
  e [app-estudos](https://github.com/leosalema213/app-estudos/releases/tag/v0.7.8),
  ambas vinculadas ao commit aprovado. Instaladores Organon/Compasso idênticos
  nos dois canais, com checksums públicos conferidos e catálogo assinado preservado.
  SHA-256: `01c8a41d10c295857a2df3dc13ceb3e1819b6dd4628b9ee2cb62a9cc9d60fe94`.
- AppUpdates consultou a rede real e ofereceu `0.7.8` tanto para `0.7.7` quanto
  para `0.7.8-preview.1`, nos dois repositórios. O teste do workflow foi confirmado
  por inspeção externa após sua conclusão. Logs completos em
  `.organon-build/ci-42899475120-publish-success.log`; resumo local em
  `.organon-build/publication-0.7.8.json`.
- A publicação automática está ativa para próximas versões estáveis aprovadas;
  o aceite do preview continua obrigatório. O token precisa continuar válido e
  manter acesso aos dois repositórios. Este registro documental não altera as
  fontes distribuídas e não exige outro preview, build ou suíte de testes.

## Ajuste da modal de atualização — preview 0.7.9-preview.1

Em 10/11/2026, a pedido do usuário, removida a ação Depois quando a atualização
está pronta. A modal de 480 px mantém as duas ações na mesma linha e permite
fechar pelo X; agendamento, cancelamento e instalação preservam o fluxo existente.
`npm run preview` concluiu em **62 segundos**, sem nova tentativa nem repetição de
suítes funcionais: ASAR com 228 arquivos conferidos, abertura real em perfil
temporário sem erros e checksums gerados. Retenção: `0.7.9-preview.1` e
`0.7.8-preview.1`. Log em `.organon-build/2026-11-10T21-07-09-921Z-preview-17836.log`.
O instalador está em `release/0.7.9-preview.1/Organon-Instalar.exe`. Após a entrega,
o usuário aprovou o preview e autorizou publicar; a final **0.7.9** foi promovida
com o registro de aprovação. O push do lote à main aciona o workflow existente,
que gera o instalador estável e publica nos dois canais, sem novo build local.
