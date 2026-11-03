# Contrato de dados e migrações pendentes

Este registro acompanha alterações persistidas enquanto a configuração do Supabase está pendente. O aplicativo continua local/offline; não é necessário aguardar o servidor para desenvolver funcionalidades. O diagnóstico e os requisitos para retomar a integração estão em `SUPABASE.md`.

## Retomada da sincronização — 03/11/2026

### Perfil da conta e fases do envio — 0.5.6-preview.2

- `public.organon_profiles`, criada pela migration remota `organon_account_profiles`, contém `user_id` (UUID de Auth, PK/FK com cascata), `name` (até 80 caracteres, padrão vazio), `nickname` (até 40, padrão vazio), `avatar_hash` (SHA-256 opcional) e `updated_at`. RLS limita SELECT/INSERT/UPDATE/DELETE ao proprietário; anônimos não acessam. SQL reproduzível em `supabase/profile.sql`. A conta antiga sem linha recebe perfil vazio na leitura, usando o e-mail como fallback visual; o primeiro salvamento cria a linha.
- Fotos são preparadas em WebP de até 256 pixels no maior lado e 128 KiB, enviadas para `<user_id>/<sha256>` no bucket privado existente. Assinatura, tamanho e hash são verificados pelo processo principal. A linha só é atualizada após upload. Remover foto limpa a referência, sem apagar assets antigos; nome/apelido não dão permissão sobre outros usuários. Editar somente texto conserva a foto existente.
- `cloud-state.json` recebe cache opcional `profile: {userId, name, nickname, avatarHash, avatar}` para exibir a identidade na reabertura/offline. O cache só aparece quando `userId` coincide com a sessão ativa. Ausência em perfis antigos não exige migração. Falha de atualização conserva o cache anterior e é informada. O cache é separado do snapshot/backup portátil dos estudos; a identidade pertence à conta, evitando que a importação dos estudos de outra pessoa altere o perfil.
- O contrato IPC acrescenta `cloud:profile` e campos públicos de nome/apelido/foto, `profileError` e `progress: {stage, completed, total}` ao status. O progresso é transitório e não entra em backups. Cadastro/login só autenticam e protegem a sessão; o renderer inicia a sincronização em uma chamada independente após liberar a modal. Uma saída entre as duas operações preserva `pending` e retoma na abertura seguinte.
- As etapas distinguem autenticação, conferência, preparo, upload, commit, download e edição de perfil. A contagem representa objetos/partes a enviar, e não bytes nem percentual do tempo. Dados pessoais continuam salvos no computador quando conectados; a sidebar distingue conta conectada, envio, pendências e erro sem prometer colaboração/rede continuamente disponível.
- O esquema de times/quadros em tempo real é uma proposta separada em `COLABORACAO-E-TIMES.md`; não foi implantado. A sincronização por snapshot segue apenas para os dados pessoais.
- Validação da prévia 2 aprovada no terminal do usuário em 03/11/2026: 13 testes de dados/controlador, build Vite, fluxo de interface com rede simulada (cadastro separado de upload lento, progresso, nome/apelido, foto/remoção e logout) e teste remoto com perfil privado, atualização em outro computador, cache, sessão e isolamento. Após corrigir apenas a busca textual do teste no logout, a retomada `--resume-account` completou interface e servidor sem repetir os 13 testes/build aprovados. Execução remota `13bcbc41-c859-4d9b-a296-2cd601e6b78b`; ausência de snapshots, perfis, objetos e sessões conferida, mas a remoção das duas contas sintéticas permanece pendente porque a confirmação do conector expirou em duas tentativas (detalhes em `SUPABASE.md`). Nenhum dado pessoal usado nos testes.

- Provisionamento resolvido (`ACTIVE_HEALTHY`). O esquema existente em `supabase/schema.sql` foi aplicado no projeto dedicado Organon como migration remota `organon_cloud_sync`; nenhuma tabela pessoal anterior foi substituída. RLS, RPC e bucket privado foram criados. Advisors sem alertas; `tests/cloud-sync.cjs` aprovado no terminal do usuário em 03/11/2026: 11 testes, build e fluxo real com duas contas sintéticas. O bloqueio descrito nas seções históricas abaixo correspondia ao estado anterior.
- O snapshot local continua na versão 1. IDs, perfis, preferências, histórico e formatos de exportação/importação não mudam. Não há migração destrutiva de dados. Perfis/backups sem livros/mídia mantêm o payload antigo; livros e mídia exigem acesso aos respectivos binários ao empacotar, evitando cópias incompletas.
- Novo campo **exclusivo do transporte** `organonFiles: { version: 1, books: { [sha256]: { size, chunks: [sha256] } }, anki: { [sha256]: { size, chunks: [sha256] } }`. Cada parte tem até 4 MiB; a última tem o restante exato. O manifesto participa do checksum canônico do payload e é removido antes de restaurar o documento. Snapshots antigos sem binários continuam aceitos sem esse campo. Metadados de livro/mídia sem manifesto completo são recusados.
- Partes vão para `organon-assets/<user_id>/<sha256>` com MIME `application/octet-stream`, sob as mesmas políticas de proprietário. O bucket permite esse MIME além das imagens anteriores. **Não requer nova coluna/tabela:** o manifesto cabe no JSONB; a alteração efetiva de Storage está em `schema.sql`. Os formatos/MIMEs de origem continuam verificados pelo modelo de arquivos local depois de recompor os bytes.
- Antes do envio, leitura e verificação integral dos arquivos locais; ausência/corrupção impede o commit. Uploads usam partes por hash, sem upsert nem permissão de UPDATE no Storage; colisão por envio concorrente verifica o objeto existente. A revisão só é confirmada depois dos uploads. Download valida hashes de partes e do arquivo, tamanho e assinatura; arquivos já presentes e íntegros são reutilizados. Binários antigos permanecem disponíveis à recuperação local. `bookFiles`/`ankiFiles` seguem sendo exclusivos do backup portátil; miniaturas não são sincronizadas.
- Limites locais continuam 200 MiB por livro e 32 MiB por mídia; as partes limitam memória de rede e uploads individuais, mas o serviço mantém suas cotas totais de armazenamento/tráfego. O preparo ainda lê um arquivo completo de cada vez, e o download recompõe um arquivo completo em memória. Não foi adicionada limpeza automática de assets órfãos nem cobrança/plano pago.
- Configuração reativada na 0.5.6-preview.1 após a aprovação dos testes reais e do cadastro sem confirmação de e-mail. O teste real comprovou também arquivos, backup portátil, conflito, revisão esperada, isolamento entre contas e proteção/reabertura/refresh da sessão. Não considerar testes simulados, schema aplicado ou advisors vazios isoladamente como validação do fluxo autenticado completo. As duas contas sintéticas foram removidas após conferir ausência de objetos, snapshots e sessões; nenhum dado pessoal foi enviado pelo teste.

## Antecipação da aprendizagem Anki — 0.5.5

- `anki.settings.learnAhead` é opcional no snapshot versão 1, inteiro entre 0 e 1440 minutos. Novas coleções e perfis/backups antigos sem o campo recebem 20; um zero explícito é preservado. A opção vale para toda a coleção, independentemente do preset/baralho, e fica em Opções → Aprendizagem.
- A fila oferece primeiro todas as cartas elegíveis pelos horários e limites normais. Ao final, acrescenta aprendizagem/reaprendizagem futura até `agora + learnAhead`, em ordem de vencimento, somente antes do próximo início de dia de estudo. Suspensão, enterro, tipos incompatíveis e escopo do baralho continuam respeitados. Zero aguarda o vencimento; revisões futuras não são antecipadas. Os contadores usam a mesma fila, incluindo as cartas elegíveis à antecipação.
- A migração e a consulta da fila não reescrevem `due`, passos, intervalos, IDs ou histórico. Responder continua registrando o horário real e usando os passos existentes. A opção não garante equivalência integral com os demais cálculos/variação aleatória do Anki.
- Backups portáteis, restauração e payload JSONB carregam o campo dentro do snapshot; nenhuma tabela/DDL nova é necessária. Aplicação remota do Supabase continua pendente. A preferência de antecipação do perfil Anki não é inferida dos passos do pacote importado; importações sem o campo recebem o padrão 20.
- Validado no terminal do usuário em `tests/anki-learn-ahead.cjs`: os cinco testes de dados passaram, o build Vite concluiu e o fluxo Electron confirmou padrão 20, zero persistido após reabertura, contadores, prioridade das cartas novas e vencimentos preservados em perfil temporário. Os testes de dados cobrem migração/validação, janela, limites, exclusões, virada do dia, duas respostas Bom e backup/payload. Não representa validação do servidor remoto.

## Roteiros por data e versões do modelo — 0.5.3-preview.2

- `plans[].dayOverrides` é opcional: mapa de datas locais `YYYY-MM-DD` para `{name, blocks}`. Só as datas editadas recebem uma entrada. As atividades preservam IDs existentes; novas atividades recebem novos IDs. Alterar ordem/nome/duração ou remover um bloco não remove registros de horas/checks. Uma sequência vazia é permitida no dia e significa ausência de atividades.
- `plans[].templateHistory` é opcional: lista crescente de `{before, name, days, blocks}`. Ao editar a estrutura/nome/dias do modelo, a versão anterior é guardada com corte na data local atual; várias edições no mesmo dia preservam apenas a primeira versão anterior a essa data. A resolução escolhe a primeira versão cujo `before` seja posterior à data consultada, ou o modelo atual; o override da data, se houver, tem precedência.
- Perfis/backups antigos sem esses campos continuam usando o modelo existente, sem recriar IDs ou inventar sequências passadas. O histórico de versões começa nas novas edições; roteiros já alterados antes desta funcionalidade não são reconstruídos por adivinhação. É possível selecionar uma data anterior e ajustá-la explicitamente em Meu dia.
- Os IDs podem reaparecer em snapshots de datas/versões do mesmo plano; dentro de cada sequência, devem ser únicos. Datas, durações, tipos e atividades personalizadas são validados; overrides não podem substituir outros atributos do plano. O snapshot continua na versão 1. Não há nova tabela nem DDL: os campos opcionais pertencem ao JSONB do plano.
- Resumo diário, checks, crédito manual, reprodução, preparação do próximo bloco, tempo extra e validação de sessão ativa resolvem as atividades pela data. Editar a sessão atual pausa e conserva o tempo; retirar sua atividade prepara a próxima pendente, pausada. Editar outra data não interrompe a sessão atual. Horas de atividades retiradas continuam no progresso.
- Anotações continuam pertencendo ao plano; o seletor de aula consulta a sequência da data da anotação. Duplicar um plano copia o modelo atual com novos IDs e não copia overrides/histórico de modelos.
- Backup portátil e exportação/importação preservam os dois campos e sessões em atividades exclusivas do dia. O payload JSONB preparado os inclui; a aplicação remota permanece pendente. `tests/daily-plans.test.js` cobre isolamento, histórico, timer, crédito, tempo extra, validação e roundtrip/payload; `tests/daily-plans.cjs` prepara o fluxo Electron e reabertura. Execução no terminal do usuário, sem alegação de validação remota ou de testes ainda pendentes.
- Na prévia 2, o usuário confirmou os sete testes diários e dez regressões de timer/tempo extra, além dos três testes e fluxo Electron do editor. O roteiro diário adicionou a aula e conferiu ontem, mas parou aguardando o botão Voltar para hoje com um nome acessível que não corresponde ao seu título. Na prévia 3, o seletor usa `getByTitle` e a reabertura aguarda o conteúdo; `--ui-only` permite continuar apenas esse fluxo, sem repetir os 20 testes já aprovados. Não há nova alteração persistida nesta revisão.
- Na prévia 3, o usuário executou a continuação `tests/daily-plans.cjs --ui-only` com sucesso: inclusão, exclusão, renomeação, ontem/amanhã isolados, modelo com histórico, player pausado e reabertura. Build também concluído. Esses resultados completam a validação funcional focada do lote local; o ajuste de largura da barra ainda depende da conferência visual do usuário. Não há validação remota nova.

## Formatação compartilhada — 0.5.3-preview.1

- Documentos de cadernos e anotações de planos passam a aceitar os marks `underline` e `textColor`, este último com `attrs.color` hexadecimal de seis dígitos. O esquema anterior de texto, imagens, listas e títulos continua aceito. Documentos antigos são lidos sem regravação automática.
- Notas/lembretes aceitam `descriptionDocument` opcional no formato de documento validado, somente com texto/formatação (sem imagens). `description` continua sendo texto simples, limitado a 4.000 caracteres, e deve coincidir com `documentText(descriptionDocument)` quando este existir. Busca, prévias textuais e notificações continuam usando `description`. Sem documento, a descrição antiga é adaptada apenas no editor e mantida como texto até ser alterada.
- Campos de notas Anki continuam sendo strings em `anki.notes[].fields`, agora editáveis visualmente. Cores criadas no editor são serializadas em spans com `data-organon-color` e uma cor literal validada; o renderer preserva essas escolhas no dark sem restaurar fundos importados. Áudio segue como `[sound:nome]`, imagens como referências ao armazenamento existente. Não há alteração de identificadores, tipos de nota, cards ou agendamento.
- HTML avançado importado é detectado por campo e aberto no editor de origem; abrir/salvar sem alterações preserva seu conteúdo exato, inclusive estruturas que não cabem no editor visual. O HTML não é inserido diretamente na interface; a prévia das cartas continua no iframe restrito e sanitizado.
- Exportação/importação do snapshot e backup portátil preservam os documentos e strings; o payload JSONB preparado também inclui os campos opcionais. O snapshot continua na versão 1. Não há nova tabela nem DDL: os atributos pertencem ao JSONB existente. A aplicação e validação remotas continuam pendentes, sem teste simulado apresentado como servidor real.
- `tests/rich-format.test.js` cobre validação, documentos antigos, descrição/texto consistente, rejeição de cores/conteúdo inválidos, backup e payload. `tests/rich-format.cjs` prepara validação focada em perfil temporário de formatação, mídia, HTML importado, cores na revisão escura, cadernos, anotações de plano, Notas e reabertura. Execução funcional fica com o usuário; build local não substitui esses testes.
- O usuário retornou três testes de dados aprovados e build concluído na prévia 1; o fluxo de interface parou no seletor ambíguo de Verso, que também encontrou o input de cor. A prévia 2 restringe a busca ao nome acessível Verso e oferece `tests/preview53.cjs` para continuar a validação junto com os roteiros diários. O restante do fluxo de interface não foi declarado aprovado.

## Tipos personalizados de atividade — 0.4.9 local

Modelo principal permanece na versão 1, com campos opcionais para compatibilidade:

```js
{
  blockKinds: [{ id: 'uuid', name: 'Revisão', icon: 'brain' }],
  plans: [{ blocks: [{
    id: 'uuid-do-bloco',
    type: 'lesson',
    name: 'Revisar capítulo 2',
    minutes: 25,
    kind: { id: 'uuid', name: 'Revisão', icon: 'brain' }
  }] }]
}
```

- `blockKinds` é o catálogo pessoal compartilhado entre planos. Aula e Descanso são padrões embutidos e não precisam ser duplicados nesse catálogo.
- `type` preserva os valores legados `lesson` e `break`: atividades personalizadas têm semântica de foco e usam `lesson`. Isso mantém contagem manual, tempo extra, descansos e métricas compatíveis.
- `kind` é uma cópia da identidade, nome e ícone do tipo, armazenada em cada bloco personalizado. Timer e registros históricos também preservam essa identificação. O bloco não depende de uma consulta à nuvem nem da presença da entrada no catálogo para ser exibido.
- Nome personalizado: até 40 caracteres, sem duplicação de nome após normalizar acentos e maiúsculas. IDs permanecem estáveis e os ícones usam a biblioteca existente.
- Criar um tipo salva o catálogo imediatamente e acrescenta um bloco ao rascunho do plano. Cancelar a edição do plano descarta os blocos do rascunho, mas mantém o tipo criado para reutilização.

### Migração local e backups

Perfis antigos recebem `blockKinds: []` na carga; o validador aplica o mesmo default aos backups antigos. Blocos sem `kind` continuam sendo Aula ou Descanso, sem alteração de IDs, nomes, durações, notas ou registros.

Exportação inclui o catálogo e as cópias dos tipos nos blocos/registro/timer. Importação valida esses campos; um bloco com cópia válida pode ser restaurado mesmo se a entrada correspondente não estiver no catálogo. Não é feita conversão automática de aulas antigas que tenham sido apenas renomeadas para “Revisão”, pois isso seria inferir intenção a partir de texto livre.

### Supabase

**Não exige DDL adicional.** O esquema preparado em `supabase/schema.sql` armazena o estado em `organon_sync_state.payload` (JSONB). O serializador existente percorre todo o estado, preservando `blockKinds` e `kind`, sem lista fixa de colunas por funcionalidade. Hashes canônicos incluem esses campos e detectam mudanças no catálogo.

Os testes do controlador com serviço simulado passaram a incluir um catálogo e bloco personalizados, comprovando o transporte completo e a restauração. O teste de backup Electron também inclui esses campos na comparação integral de exportação/importação e reinício. Isso prepara a compatibilidade; a validação remota continua pendente.

### Validação

- `npm test`: nomes duplicados, integridade dos tipos, migração antiga, foco/crédito manual, timer/tempo extra, histórico e roundtrip.
- `npm run test:block-types`: criação com seletor de ícones, lista excedente, limite de duas linhas sem overflow, janela 840×620, edição do plano e persistência após reiniciar.
- `npm run test:backup`: comparação integral do JSON em perfil limpo, incluindo tipos personalizados.

## Livros — 0.4.10 local

Campo opcional `books: []` no snapshot versão 1. Perfis e backups anteriores recebem o default vazio, preservando todos os identificadores e os demais dados. `notebooks` continua representando cadernos; não foi renomeado nem reaproveitado.

Cada livro contém `{ id, title, format: 'pdf', hash, size, planIds: [], page: 1, pageCount: null, furthestPage: 0, completedAt: null, importedAt, view: { spread: 1, zoom: 1, contrast: 'paper' } }`. `hash` é SHA-256 dos bytes originais. A cópia imutável fica em `<perfil>/books/<hash>.pdf`, com limite de 200 MiB por arquivo. O caminho original nunca é persistido. A importação verifica extensão e assinatura; o leitor PDF.js verifica a estrutura ao abrir e apresenta erro para PDFs inválidos/protegidos. Sem OCR ou execução de conteúdo ativo.

Importações idênticas deduplicam por conteúdo e conservam a entrada já existente. `planIds` aceita múltiplos IDs; não cria blocos nem altera o roteiro diário. Livros sobrevivem à exclusão de planos; IDs órfãos são preservados e não exibidos como vínculos existentes. Excluir a entrada não apaga automaticamente o arquivo interno: referências antigas podem ser necessárias para recuperação. Limpeza física futura precisa considerar backups/recovery; arquivos sem entrada não são exportados.

`page` é a página corrente (primeira do par), salva após renderização; `furthestPage` é a maior página efetivamente exibida, incluindo a segunda página do par. Porcentagem = `floor(furthestPage / pageCount * 100)`. Não é medição de páginas lidas nem cobertura contínua. `completedAt` é data local do check explícito; independe da posição, permite reabertura e participa dos mesmos intervalos semanais/mensais dos planos. Nenhum tempo de estudo é criado pelo leitor. Preferências de layout, zoom e contraste são individuais. O fechamento após usar o leitor aguarda o flush local pelo protocolo de fechamento já existente.

### Binários e backup

O JSON de trabalho mantém somente metadados. Nenhum tick do timer lê ou regrava PDFs. Exportação usa o snapshot atual em memória e acrescenta `bookFiles: { [hash]: base64 }` apenas no arquivo portátil. Cada hash é exportado uma vez, em blocos de base64, para arquivo temporário; um PDF ausente/corrompido aborta a exportação sem substituir um backup anterior completo.

Importação lê e verifica todos os arquivos (assinatura, tamanho e hash) antes da confirmação; os buffers ficam temporariamente no processo principal, fora do renderer. O preview recebe metadados e um token transitório. Cancelar não instala arquivos nem muda os dados. Confirmar copia os binários verificados por gravação temporária/rename e só então restaura o snapshot validado. `bookFiles` e o token não entram no JSON de trabalho. Falhas de cópia não substituem os metadados existentes; arquivos imutáveis já copiados podem ficar sem referência e ser reaproveitados em nova tentativa. Backups antigos sem livros continuam válidos. Na importação, o JSON completo e os buffers ocupam memória; o limite por livro não é uma promessa de memória ilimitada para uma biblioteca inteira.

### Transporte futuro e Supabase

**Sem DDL nesta entrega.** Os metadados opcionais cabem no snapshot JSONB existente. O transporte atual (`packDocument`) recusa snapshots com livros: só enviar hashes sem os arquivos produziria uma cópia incompleta. A configuração continua `enabled:false`; não foi acessado nem alterado o servidor.

Na futura habilitação, os PDFs deverão ser assets privados de tipo `application/pdf`, endereçados por `<user_id>/<sha256>`, com verificação de bytes e tamanho ao receber. Upload de arquivos ausentes deve preceder o commit da revisão do snapshot; só confirmar o download após instalar todos os binários e salvar o estado. Deduplicação, revisão esperada, RLS por usuário, cotas, limite de objeto, MIME permitido do bucket e recuperação integral precisam ser implementados e validados no serviço real antes de remover o bloqueio. Não há migration vazia ou alegação de teste remoto.

### Validação

`npm test` verifica defaults antigos, limites, posição versus ponto mais avançado/conclusão, independência do roteiro, deduplicação, original movido, caminhos inválidos, backup íntegro em perfil limpo, corrupção/falta de binários e bloqueio do transporte remoto incompleto. `npm run test:books` usa PDFs sintéticos e perfis temporários para testar os controles de produção, texto selecionável, reinício, layout, vínculos múltiplos, períodos e exportação/restauração. `ORGANON_REFERENCE_PDF` permite validar um PDF explicitamente fornecido sem adicioná-lo ao repositório; não é uma dependência do teste padrão.

### EPUB e Kindle no mesmo lote 0.4.10

`format` também aceita `epub`, `mobi`, `azw` e `azw3`. EPUB fica em `<hash>.epub`; os três sufixos Kindle compartilham a cópia canônica `<hash>.mobi`. PDFs existentes continuam em `<hash>.pdf`, sem renomeação nem novo ID. A assinatura do contêiner é validada além da extensão; Kindle com sinalizador de criptografia é recusado. A estrutura interna é validada pelos parsers ao abrir. EPUB refluível e MOBI/KF8 sem DRM têm suporte direto; EPUB de layout fixo e KFX são recusados com erro específico. EPUBs têm limite adicional de 512 MiB descomprimidos no total e 64 MiB por recurso antes da leitura de entradas.

Campos opcionais novos: `location` (CFI canônico do começo do trecho), `fraction` (posição atual entre 0 e 1), `furthestFraction` (maior fim de trecho exibido entre 0 e 1), `view.fontSize` (12–36, default 20). Os campos PDF `page/pageCount/furthestPage` permanecem intactos e só são interpretados para PDF. Ausência de localização significa primeira abertura; ausência das frações significa zero. Mudar fonte/layout ou redimensionar a janela preserva o CFI; navegar deliberadamente o atualiza. A porcentagem do card usa `floor(furthestFraction * 100)`, sem concluir automaticamente nem adicionar horas. Backups incluem os mesmos bytes originais sob `bookFiles`, com validação de formato, hash e tamanho; metadados antigos de PDF continuam válidos sem migração física.

O serializador remoto continua bloqueando qualquer biblioteca não vazia. O futuro transporte precisará acrescentar MIME de EPUB (`application/epub+zip`) e Kindle (`application/x-mobipocket-ebook`) aos assets privados, além de PDF; não houve alteração de servidor/DDL.

Foliate.js usa a revisão `78914aef4466eb960965702401634c2cb348e9b1`. Integração usa os módulos de formato/paginação, sem um segundo PDF.js. Antes do iframe, cada documento é reconstruído sem script, iframe/object/embed, base, formulário, meta de navegação ou atributos de evento. Recebe CSP própria com `script-src 'none'`, recursos locais blob/data e sem rede, navegação ou formulários. O iframe no Chromium fica com `sandbox="allow-same-origin"`, sem `allow-scripts`. Links externos não abrem pelo livro. Testes incluem tentativas sintéticas de script e onerror.

`npm run test:ebooks` verifica EPUB/MOBI/AZW sintéticos, fonte, duas colunas, CFI após reinício, remoção de conteúdo ativo e backup/restauração em perfil limpo. A amostra KF8/AZW3 opcional vem de [Project Gutenberg, eBook 11](https://www.gutenberg.org/ebooks/11); `ORGANON_AZW3_REFERENCE` aponta para a cópia local de teste, mantida fora do repositório e da aplicação. `npm run test:books` também verifica Ctrl + scroll, scroll comum sem zoom, botões −/+ e maximização/restauração reais da janela.

## Miniaturas de PDF — 0.5.1

As capas são um cache derivado da primeira página do PDF, em `<perfil>/books/thumbnails-v1/<sha256-do-pdf>.webp`, com até 240×320 pixels e 64 KiB. A imagem completa cabe no espaço existente do card, sem recorte. Os caminhos aceitam apenas hashes SHA-256; o IPC de cache aceita somente dados WebP limitados e grava por arquivo temporário/rename.

Não há campo novo no snapshot, no modelo nem no payload: não exige defaults, DDL ou migração de IDs. PDFs antigos recebem miniatura quando seus cards entram na área visível. A geração usa a mesma versão local do PDF.js do leitor, em fila de um documento por vez, sem registrar páginas lidas, conclusão ou progresso. PDFs com senha/erro e outros formatos mantêm o ícone.

Os arquivos PDF originais continuam imutáveis e no backup `bookFiles`. O cache não entra em exportações, checkpoints do cronômetro ou sincronização: em perfil limpo, as miniaturas são regeneradas a partir dos próprios livros restaurados. Isso preserva o backup completo dos dados autoritativos sem duplicar imagens derivadas no JSON. Cache ausente/corrompido ou falha de gravação não bloqueia a biblioteca nem a leitura. Nenhuma aplicação remota é necessária.

Validação focada preparada em `tests/book-thumbnails.cjs`: executa apenas os testes de cache, verifica a renderização real da primeira página, cache após reinício, preservação do PDF/progresso, regeneração após backup e remoção da frase em Notas. Produz `test-output/book-thumbnails.png` para inspeção visual; sua execução fica a cargo do usuário conforme `AGENTS.md`.

## Anki — 0.5.2-preview.1

Campo opcional `anki` no snapshot versão 1. Perfis antigos recebem `emptyAnki()` durante carga; `validateData` aplica o mesmo default aos backups antigos, sem alterar planos, livros, cadernos, notas, histórico do cronômetro, preferências ou identificadores legados. A comparação de checkpoints do timer inclui a identidade de `anki`, para que uma resposta ou edição seja salva imediatamente pelo fluxo normal.

Contrato resumido:

```js
anki: {
  version: 1,
  decks: [{ id, name, presetId, options?, today?: { day, options }, source? }],
  presets: [{ id, name, options }],
  models: [{ id, name, kind, fields: ['Front', 'Back'], templates: [{ name, q, a }], css, sourceConfig?, sourceTemplates? }],
  notes: [{ id, modelId, fields: ['conteúdo'], tags: [], guid?, source? }],
  cards: [{ id, noteId, deckId, ord, position, state, due, interval, ease, reps, lapses, step, suspended, buriedUntil?, lastReview?, fsrs?, unsupported?, source? }],
  reviews: [{ id, cardId, at, rating, previousState, interval, elapsedMs, source? }],
  media: { 'nome-canônico.ext': { hash, size, mime } },
  sourceMedia?: { 'namespace-da-coleção': { 'nome-original.ext': 'nome-canônico.ext' } },
  settings: { fsrs: false, rollover: 4, learnAhead: 20, newIgnoreReview: false, limitsFromTop: false, source? }
}
```

`state` usa 0 novo, 1 aprendizagem, 2 revisão, 3 reaprendizagem. `due`, `at`, `buriedUntil` e `lastReview` são timestamps em milissegundos; intervalo é em dias. Novos têm `due:0` e posição independente. `fsrs` preserva estabilidade/dificuldade e estado serializado da biblioteca; datas desse estado são números, reconstruídos antes de chamar o scheduler. Dados de origem são JSON/string/base64 inertes. Fonte, scheduler, conversões de data, reimportação e diferenças conhecidas são descritos em `ANKI.md`.

Opções têm defaults definidos em `src/anki.js`. Padrões de switches de novos baralhos foram explicitamente definidos pela implementação, sem inferir que eram os switches da captura. Importação obtém os valores efetivos do pacote. Opções por baralho/dia sobrescrevem apenas limites; opções de preset se aplicam aos baralhos vinculados. `today.day` usa a data local de estudo com rollover configurável e deixa de valer automaticamente no dia seguinte. Exclusão de nota não apaga o histórico de respostas nem arquivos físicos, para permitir recuperação em backups anteriores.

### Arquivos e restauração

Binários ficam em `<perfil>/anki-media/<sha256>`, imutáveis e deduplicados. O snapshot só contém os metadados; nenhum tick do timer lê ou regrava áudio/imagem. Cada recurso tem até 32 MiB; nomes/extensões e assinaturas MIME são verificados. Caminhos de leitura interna aceitam somente hashes SHA-256. Importação de pacote escreve em cópia interna, nunca no perfil Anki de origem. Cancelar o preview pode deixar arquivos sem referência; eles não entram em backups sem uma referência no snapshot e não são removidos automaticamente.

O escritor de backup existente acrescenta `ankiFiles: { [hash]: base64 }` em streaming, uma vez por hash, além de `bookFiles`. Mídia ausente, tamanho/assinatura/hash incorretos abortam exportação antes de substituir um backup completo. Importação verifica todos os binários Anki e livros antes da confirmação; o token transitório existente aponta para os buffers no processo principal. Confirmar instala os arquivos verificados por temporário/rename antes de devolver metadados para restauração; cancelar não altera o snapshot. `ankiFiles` e `bookFiles` são retirados do documento de trabalho. Como no backup de livros, a leitura/restauração integral ainda usa memória proporcional ao tamanho do JSON e dos buffers.

### Transporte remoto

**Sem DDL adicional:** campo opcional cabe no payload JSONB existente. A sincronização remota continua desabilitada por provisionamento pendente. `packDocument` bloqueia qualquer coleção com mídia Anki, assim como faz com livros, para não anunciar uma cópia remota incompleta. Coleções sem mídia seguem o serializador genérico, incluindo tipos, opções, históricos e origem. Antes da habilitação remota, será necessário implementar assets privados de áudio/imagem por hash, cotas, MIME permitido, verificação de conteúdo e commit atômico do snapshot após upload/download dos recursos; validação no servidor permanece pendente.

### Validação preparada

Na prévia 3, a interface de revisão oferece Errei (1) e Acertei (Bom/3). O contrato de cards, presets e histórico não muda: avaliações 2/4 antigas são preservadas, assim como os parâmetros e vencimentos importados. Áudio e flip card são alterações da sessão visual, sem novos defaults, binários ou campos de migração. A regressão de importação da prévia 2 passou no terminal do usuário; a verificação nova de áudio/respostas fica em `tests/anki-review.cjs`, ainda pendente de execução funcional pelo usuário.

`tests/anki.test.js` verifica defaults/migração, referências, agendamento/FSRS, opções, limites/enterro, mídia, backup íntegro, bloqueio de transporte incompleto e importação real de SQLite em ZIP moderno/legado. `tests/anki.cjs` compila e executa também um fluxo Electron focado em perfil descartável para revisar, reproduzir áudio, bloquear scripts e criar/editar notas/opções. Executado pelo usuário em 29/10/2026: 11 testes passaram, zero falhas; build Vite e fluxo Electron concluídos com sucesso. Não contém cards pessoais nem acessa o perfil pessoal. Validação remota e equivalência integral com o Anki não são cobertas por esse resultado.

## Continuidade do player e presets — 0.5.2-preview.4

`active` mantém o mesmo contrato: ao terminar pelo cronômetro ou por check manual, pode apontar para o próximo bloco pendente da sequência do dia, com `running:false`. Essa preparação não cria registros, não marca conclusão e não credita tempo; preserva tempo parcial já estudado nesse próximo bloco. Pula blocos concluídos, planos finalizados e planos fora do dia; segue a ordem dos planos/blocos sem voltar ao começo. No fim do roteiro, uma sessão terminal concluída pode permanecer para o fluxo de tempo extra. A notificação usa os dados do bloco que terminou, não os do bloco preparado. Ao carregar um perfil antigo com player em bloco já marcado, prepara o próximo sem modificar o histórico.

Presets redundantes `default` local/Default importado são normalizados na carga, validação e mesclagem. A unificação só ocorre quando o padrão local está sem uso e sem personalização, ou as opções são equivalentes; os vínculos são redirecionados ao ID importado e `aliases:['default']` preserva o identificador anterior. Configurações diferentes/personalizadas são mantidas e recebem nomes únicos em caso de colisão. `aliases` é opcional e validado como lista de strings. Presets novos usam UUID; criar copia as opções atuais e salvar confirma a criação/vínculo. Limites de baralho/dia permanecem separados dos valores compartilhados do preset.

Snapshot versão 1, binários e identificadores de planos/blocos/cards não mudam. `aliases` e a seleção pausada viajam pelo JSON/backup existentes e cabem no payload JSONB, sem DDL; transporte remoto de mídia e validação real do servidor continuam pendentes. Dados de CSS/templates importados são preservados mesmo sem editor visível; as adaptações de cores dark ocorrem somente na renderização.

Verificação preparada em `tests/preview4.cjs`: testes focados de player/presets e regressões dos timers/crédito/tempo extra, build e fluxo Electron em perfil temporário para passagem entre planos, criação de preset e abas. A execução funcional fica pendente do usuário. A captura isolada `--screenshots-only` foi usada para inspecionar somente as telas alteradas, sem executar a suíte funcional. O agendamento Anki não foi substituído: o exemplo tradicional Errei=10m/Acertei=3d tem regressão específica, mas equivalência integral do scheduler continua pendente.

## Exclusão de baralhos — 0.5.2-preview.5

Não há novos campos ou versão de snapshot. `removeDeck` exclui o baralho selecionado e nomes descendentes com separador `::`, os cards desses IDs e as notas afetadas que deixaram de ter cards. Uma nota com card em outro baralho permanece intacta; notas órfãs pré-existentes e baralhos com prefixos semelhantes sem `::` também são preservados. A ação exige confirmação no renderer; cancelar não chama a mutação. Alterações invalidam o desfazer anterior, para não ressuscitar uma exclusão por um undo de revisão antigo.

Histórico de respostas preserva referências a IDs de cards removidos, conforme contrato existente de exclusão de notas, mantendo estatísticas históricas. Presets, tipos de nota e manifestos/binários de mídia não são apagados por essa ação. Backups continuam completos e a aplicação não realiza limpeza física automática. A exclusão das entradas é transportada pelos arrays do snapshot completo; não há DDL, novos defaults ou aplicação remota. Contadores e novos posicionamentos de controles são derivados da sessão, sem dados persistidos adicionais.

Validação preparada: `tests/anki-decks.test.js` cobre descendentes, notas compartilhadas, órfãs anteriores, histórico, ausência de mutação e categorias dos contadores. `tests/preview5.cjs` acrescenta o fluxo Electron de cancelar/confirmar, contadores após responder, edição no card e desfazer em perfil descartável. Execução funcional pendente do usuário.

## Vínculos Anki e progresso — 0.5.2-preview.6

`anki.decks[].planIds` é uma lista opcional de IDs de planos. Carga, validação e mesclagem atribuem `[]` quando o campo está ausente; o validador recusa tipos incorretos, IDs vazios e duplicados. Cada baralho aceita múltiplos planos. A exclusão de um plano não apaga o baralho nem seus IDs órfãos, seguindo a política da biblioteca de livros. Reimportar um baralho existente conserva os vínculos locais. Criar no contexto do filtro de um plano adiciona seu ID; criar na coleção geral começa sem vínculo.

O snapshot continua na versão 1. `planIds` vai no JSON de trabalho, backup portátil e payload genérico de sincronização, sem novo binário. A restauração aceita snapshots antigos sem o campo e preserva os IDs de origem e de instalação. **Não exige DDL:** o campo cabe no JSONB existente. A sincronização de mídia permanece bloqueada, o provisionamento remoto permanece pendente e o teste de serialização não é validação de servidor.

Os indicadores de Meu progresso são derivados de `anki.reviews`, sem campos persistidos adicionais: incluem somente avaliações inteiras 1–4 dentro das datas locais do período selecionado, somam `elapsedMs` registrado, contam dias com respostas e consideram 2–4 como acertos para manter históricos antigos. Referências a cartas excluídas continuam contando no histórico. Avaliação 0 (reagendamento manual) fica fora. Um baralho ligado a vários planos não multiplica revisões ou tempo; nenhuma linha é acrescentada a `records` por navegar, vincular ou exibir esses indicadores. O tempo do cronômetro permanece separado do tempo das respostas.

As traduções são de apresentação, incluindo Frente/Verso, tipos conhecidos e Padrão. Não renomeiam chaves dos modelos, placeholders ou campos técnicos do snapshot. Rótulos de configurações traduzidos recebem sufixos visuais se colidirem, sem alterar seus IDs/nomes gravados. `PopupMenu` não persiste estado de abertura.

Verificação preparada em `tests/anki-plan-progress.test.js` e `tests/preview6.cjs`: migração/validação de vínculos, preservação de outros planos, JSON/backup e payload, métricas sem duplicação, criação/teclado do pop-up e integração das telas em perfil temporário. Execução funcional pendente do usuário; a conferência isolada de captura não é registrada como aprovação da suíte.

## Para as próximas alterações

Ao criar novos campos, registrar formato/defaults, compatibilidade de leitura, transporte no backup e snapshot e testes relevantes. Preparar SQL apenas se houver alteração real da estrutura relacional/RPC/permissões. Aplicação de migrations e testes de isolamento no servidor ficam explicitamente pendentes até retomar a integração. Não enviar dados pessoais como fixture de teste.
