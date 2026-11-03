# Histórico de versões

## 0.5.6

- Conta e sincronização com o Supabase ativadas após validação no servidor real. Cadastro com e-mail/senha sem confirmação, isolamento por usuário e proteção da sessão pelo Windows.
- Livros e mídia das cartas agora acompanham a cópia online, com partes verificadas por SHA-256, reaproveitamento de arquivos já enviados e confirmação da revisão após os uploads. Dados locais, backups e escolha explícita em conflitos são preservados.
- Cadastro/login liberam a interface antes da sincronização dos estudos, que continua em segundo plano com etapas e quantidade de arquivos. A sidebar identifica a conta e o estado do envio; perfil permite nome, apelido e foto privados, preservados entre computadores.

## 0.5.5

- Antecipação da aprendizagem configurável em Opções → Aprendizagem: padrão de 20 minutos para toda a coleção; zero aguarda o intervalo completo. Cartas antecipadas vêm depois das disponíveis normalmente, e os contadores acompanham a fila. Vencimentos, passos e histórico existentes são preservados.

## 0.5.4

- Criar uma carta mantém a modal aberta para cadastro contínuo, limpa campos/marcadores e prévia, retorna o foco ao primeiro campo e preserva baralho/tipo selecionados. Cada nova nota recebe um ID próprio; salvar uma nota existente continua fechando a edição.

## 0.5.3

- Roteiros diários em Meu dia: adicione, remova, reordene ou renomeie aulas e pausas somente na data selecionada. Modelos recorrentes preservam as versões anteriores e os roteiros personalizados.
- Editor de texto compartilhado entre cartas, cadernos, anotações e Notas, com sublinhado e cores. O acesso ao HTML usa ícone de código dentro da barra de formatação das cartas.
- Histórico, checks, tempo registrado, mídia e HTML importado são preservados. Player e tempo extra seguem a sequência de cada dia.
- Manifesto de todos os arquivos e conferência de tamanho/SHA-256 antes do instalador evitam pacotes incompletos e a tela cinza de inicialização.

<details>
<summary>Refinamentos durante as prévias e validação</summary>

- Preview 4: refaz o pacote da prévia 3, que ficou sem arquivos JavaScript/CSS principais e abriu com tela cinza. O build agora gera manifesto completo de arquivos, tamanhos e SHA-256; o empacotamento é interrompido antes do instalador se algum arquivo estiver ausente, corrompido ou diferente do build de origem.
- Preview 4: conferência do executável empacotado real em perfil temporário confirmou a abertura de Meu dia, sem falhas de carregamento ou erros JavaScript; 217 arquivos do pacote foram verificados por tamanho e SHA-256. Os testes funcionais anteriores continuam válidos.

- Preview 3: a barra compartilhada e a linha divisória ocupam toda a largura dos campos de cartas e descrições de Notas, mantendo padding interno nos controles e no texto; cadernos e anotações mantêm a largura da área de edição.
- Preview 3: corrige a navegação do teste diário para localizar Voltar para hoje pelo título e aguardar o carregamento após reabrir. O usuário aprovou os 20 testes de dados, o fluxo de interface do editor e a continuação completa do roteiro diário, incluindo isolamento entre datas, histórico, player pausado e reabertura.

- Preview 2: Meu dia permite editar o roteiro da data selecionada (nome, inclusão, remoção, ordem e duração das aulas/pausas), mantendo o modelo e as outras datas. O lápis de cada bloco segue o mesmo escopo diário.
- Preview 2: alterações futuras no modelo guardam a sequência anterior para as datas passadas; roteiros personalizados continuam independentes. IDs, checks e horas já registradas são preservados, inclusive ao retirar uma atividade do dia. Player, tempo extra, contagens e vínculos de anotações usam o roteiro da data.
- Preview 2: corrige a busca ambígua do campo Verso no teste de formatação, distinguindo-o do seletor de cor.

- Preview 1: editor visual das cartas compartilha a barra dos cadernos, com negrito, itálico, sublinhado, títulos, tamanho, listas, desfazer/refazer e cor de texto (paleta pastel ou personalizada).
- Preview 1: formatação e cores também ficam disponíveis nas anotações dos planos e nas descrições de Notas. Descrições antigas continuam legíveis e o texto simples permanece disponível para busca e notificações.
- Preview 1: cores escolhidas no editor aparecem nas cartas inclusive no dark, mantendo o fundo neutro. Áudio/imagens seguem no armazenamento de mídia; campos importados com HTML avançado mantêm o editor do original e não são convertidos ao salvar sem alterações. Tipos de nota e agendamento permanecem preservados.

</details>

## 0.5.2

- Área Anki com importação de coleções, cartas com mídia, revisão em flip card, edição de notas, estatísticas e respostas Errei/Acertei.
- Vínculos opcionais entre baralhos e planos; revisões e tempo aparecem em Meu progresso sem duplicar o cronômetro.
- Próxima atividade preparada automaticamente e sempre pausada ao concluir um bloco. Planos recebem atalhos uniformes e menu de ações compartilhado.
- README com índice, instalação e imagens novas com exemplos fictícios; limpeza local mantém somente a compilação atual e a anterior, preservando Releases publicadas.
- O agendamento importado é mantido na entrada; o agendador local tem diferenças em relação ao Anki e não garante intervalos futuros idênticos.

<details>
<summary>Refinamentos feitos durante as prévias</summary>

- Preview 8: planos em lista centralizam os dias entre informações e atalhos; menu de opções fica por último, depois de Anki, também na visualização em cards.

- Preview 7: criação e edição de baralhos incluem vínculos opcionais com planos, retirados das opções de agendamento. Planos usam o pop-up compartilhado para editar, duplicar, concluir/reabrir, excluir e vincular baralhos Anki; atalhos Livros, Anotações e Anki têm tipografia, ícones e contadores uniformes.

- Preview 6: botão Adicionar abre pop-up reutilizável, com Criar baralho/Criar carta e suporte a teclado, Esc e clique fora. Criação direta de carta continua dentro do baralho; controles Anki recebem termos em português sem alterar as chaves dos dados importados.
- Preview 6: baralhos podem ser vinculados opcionalmente a um ou mais planos, pelas opções ou pelo filtro Anki do plano. Meu dia oferece o atalho abaixo de Livros, abrindo os baralhos vinculados.
- Preview 6: Meu progresso inclui revisões Anki, tempo registrado, dias ativos e acertos no período selecionado, separados do cronômetro dos planos para evitar dupla contagem.

- Preview 5: exclusão de baralhos/sub-baralhos com confirmação, preservando notas compartilhadas, histórico e mídia; lista com ação de lixeira.
- Preview 5: cabeçalhos Anki/Livros sem subtítulo, breadcrumb de baralho com tipografia uniforme e Opções à direita. Edição fica no cabeçalho do card, desfazer tem ícone/texto alinhados e a frente mostra Novos + Aprendendo + Revisão à esquerda de Mostrar resposta.

- Preview 4: opções Anki em abas, rodapé de ações espaçado, criação de presets a partir das opções atuais e migração do Default local redundante sem perder vínculos/configurações diferentes.
- Preview 4: cards mais altos, pilha mais visível, tipografia maior, play alinhado e respostas pastel; conteúdo escuro respeita fundo neutro/texto claro, inclusive após alternar tema. Remove o editor de CSS/templates da interface e preserva os templates importados.
- Preview 4: ao concluir um bloco, o player prepara o próximo pendente, inclusive do plano seguinte do dia, sempre pausado e sem creditar tempo antecipadamente. Espaçamento do atalho Livros corrigido e progresso/conclusão recebem acentos sutis azul/verde.

- Preview 3: modais compartilham corpo, cabeçalho e ações compactos, corrigindo o espaçamento de importação e edição de notas e reduzindo padding duplicado nas demais janelas.
- Preview 3: revisão em flip card com pilha discreta e transição entre cartas, respeitando redução de movimento; botão Mostrar resposta dentro do card e apenas Errei/Acertei (Acertei usa Bom/3).
- Preview 3: áudio automático somente ao entrar no card, sem repetir ao revelar o verso; play junto ao texto e tecla R, sem barra nativa nem texto de repetição. Remove o atalho visível de enterrar e aplica superfícies neutras e tipografia do Organon ao Anki.

- Preview 2: corrige a importação de bancos Anki com `unicase` e tabelas `WITHOUT ROWID` no SQLite do executável; a adaptação ocorre exclusivamente em cópia temporária, preservando o backup original. Acrescenta regressão pelo IPC Electron, com e sem mídia.
- Preview 2: modal de baralho segue o formulário do Organon, com nome, Cancelar e Criar baralho, sem dica de hierarquia. Criação fica no topo da lista; Adicionar card aparece dentro do baralho. Diálogos nativos usam o nome Organon e explicam as opções de mídia.

- Nova seção Anki local com baralhos, contadores New/Learn/Due, notas, templates, cloze, pesquisa e revisão por quatro respostas, áudio automático/repetição com R e mídia por arrastar/selecionar.
- Importação real de pacotes Anki modernos e legados com estado de estudo, histórico e mídia; backups automáticos permitem selecionar collection.media. Dados existentes do Organon e perfis do Anki são preservados.
- Presets e opções efetivas de estudo; agendamento tradicional local e FSRS via ts-fsrs. Diferenças conhecidas e recursos ainda não suportados estão em docs/ANKI.md; não há promessa de equivalência integral com Anki.
- Backup portátil inclui mídia Anki por hash e rejeita arquivos ausentes/corrompidos. Cards importados têm scripts e conteúdo ativo bloqueados; testes focados preparados para execução pelo usuário.

</details>

## 0.5.1

- A biblioteca usa a primeira página dos PDFs como miniatura, com cache local leve e regeneração após restaurar backup, sem mudar o ponto de leitura.
- Remove o texto explicativo sobre notas vistas e notas diárias no rodapé de Notas.

## 0.5.0

- Corrige o conflito entre a prévia local e a Release 0.4.10, publicando um número superior para que as instalações existentes encontrem a atualização.
- Nova sequência de versões: após PATCH 9, avança MINOR e reinicia PATCH em zero. A 0.4.10 é preservada como histórico legado.
- Prévias passam a usar identificadores distintos, como 0.5.1-preview.1 e 0.5.1-preview.2; a versão final mantém 0.5.1 e é reconhecida como mais nova que essas prévias.
- Comandos para preparar preview/final e bloqueio de previews no publicador de produção. Planos, livros, progresso e demais dados locais permanecem no mesmo perfil.

## 0.4.10

- Biblioteca Livros independente dos cadernos, com importação de PDF, EPUB refluível, MOBI, AZW e AZW3 sem DRM, até 200 MiB por arquivo, e cópias offline deduplicadas no perfil.
- Leitor integrado com retomada automática por página, uma ou duas páginas por tela, zoom, contraste e texto selecionável quando presente no PDF. O ponto mais avançado fica separado da posição atual e da conclusão explícita.
- Biblioteca sem os textos explicativos adicionais. Seletor de páginas com opções 1/2, botões de zoom, Ctrl + scroll e maximizar/restaurar no próprio leitor.
- EPUB e Kindle guardam localização CFI independente da fonte/paginação, com fonte ajustável, contraste, uma/duas colunas e backup dos arquivos originais. EPUB de layout fixo, KFX e conteúdo protegido não são suportados.
- Vários livros por plano e vários planos por livro, com acesso pelo plano. Livros independentes não viram tarefas do Meu dia.
- Check de livro lido e listagem por semana/mês em Meu progresso, sem inventar horas de foco.
- Backup JSON portátil inclui os arquivos e verifica integridade antes de restaurar. Os binários ficam fora do JSON de trabalho e dos checkpoints do cronômetro.
- Transporte remoto recusa snapshots com livros enquanto o envio de binários não estiver implementado e validado. A nuvem permanece desativada.

## 0.4.9

- Tipos personalizados de atividade, com nome e ícone, criados diretamente no editor do plano. Atalhos ocupam até duas linhas; a lista completa aparece quando há tipos excedentes.
- Catálogo de tipos e identificação dos blocos preservados em backups, histórico e no payload preparado para sincronização. Atividades personalizadas contam como foco, mantendo o comportamento dos descansos e dos dados antigos.
- Conta opcional preparada com e-mail e senha, escolha de continuar offline lembrada neste computador e acesso posterior em Preferências → Conta. A conexão fica desativada nesta compilação até concluir a configuração e validação remota do Supabase.
- Sincronização de snapshots e imagens privadas com Supabase, envio ao abrir/fechar ou após um dia, detecção de conflitos e recuperação local antes de trazer dados da nuvem.
- Sessão protegida pelo Windows, fora do arquivo de backup; dados locais preservados ao sair da conta.
- Novas imagens, capas e rabiscos passam por uma fila de otimização fora da interface, com saída de até 1 MB e sem recompressão nos próximos backups/envios. Imagens antigas são preservadas.
- Backup restaura o cronômetro pausado com a duração e o tempo extra preservados.
- Remove a restrição de importação de 40 MB, que impedia restaurar backups grandes exportados pelo próprio aplicativo.
- Exportação usa o estado atual em memória mesmo quando o salvamento automático local falha; restauração só confirma sucesso após salvar.
- Auditoria de backup com teste Electron de exportação/importação, perfil limpo, reinício, migração e falha de gravação local.

## 0.4.8

- Após abrir e salvar os dados com sucesso, remove instaladores do atualizador da versão instalada e das anteriores, incluindo o acúmulo legado.
- Preserva downloads de versões futuras, arquivos desconhecidos, dados pessoais e Downloads do navegador; tenta novamente após 30 segundos caso o instalador ainda esteja em uso.
- Versões de desenvolvimento usam uma identificação própria no Windows, evitando conflito com o Organon instalado.
- Corrige o identificador do atalho legado Electron quando pertence ao aplicativo e informa explicitamente o nome Organon ao menu da barra de tarefas.

## 0.4.7

- Ícone da janela carregado explicitamente com o símbolo do Organon.
- Barra de tarefas do Windows recebe o ícone por um arquivo físico fora do app.asar, mantendo a identidade e os dados existentes.

## 0.4.6

- Modo compacto mantém 340×112 e oferece +2, +3 ou +5 minutos pelo botão + junto ao play; opções ocupam temporariamente o título, com teclado, Escape e fechamento ao clicar fora.
- Tempo extra vale só para a sessão/data ativa e persiste com o cronômetro, sem alterar a duração das próximas aulas ou creditar minutos antecipadamente. Aulas concluídas reabrem pausadas; descansos não permitem acréscimos.
- Aplicativo renomeado para Organon, com logo próprio e ícone de ômega invertido no Windows.
- Perfil local e identificadores de atualização preservados para manter os dados das instalações Compasso.
- Instalador Organon com cópia de compatibilidade para atualização pelos clientes anteriores.
- Preferência Iniciar com o Windows em Geral, ativada por padrão e com a escolha salva.
- Registro da inicialização usa o executável atual e é removido na desinstalação; atualizações preservam a configuração.
- Opção Lembrar-me em cada nota, desativada por padrão e preservada nos backups.
- Ao abrir, uma única notificação do Windows agrupa as notas de hoje que têm Lembrar-me ativo e ainda não foram vistas.
- Clicar na notificação restaura o aplicativo, sai do modo compacto se necessário e abre Notas no filtro Hoje.
- Perfis temporários de teste não alteram a inicialização real nem exibem notificações reais do sistema.

## 0.4.5

- Planos com escolha independente de ícone e cor, incluindo cor personalizada; ícones anteriores preservados até editar.
- Biblioteca compartilhada com mais de 70 ícones e busca, disponível em planos e cadernos.
- Escolha de ícone em popup separado, sem expandir o formulário; seleção fecha o popup e Escape cancela sem fechar a edição.
- Ação de concluir o plano inteiro, separada dos checks diários, com confirmação e possibilidade de reabrir.
- Filtros Em andamento, Finalizados e Todos; planos finalizados saem de Meu dia e mantêm histórico e anotações.
- Meu progresso mostra planos concluídos por semana/mês, total geral e lista com datas de conclusão.
- Duplicar um plano finalizado cria uma cópia em andamento, com o mesmo ícone e cor e sem copiar o histórico.
- Nova área Notas com título, descrição, data específica ou recorrência diária.
- Notas pendentes aparecem abaixo dos indicadores de Meu dia, com destaque visual; marcar como vista oculta a nota e a seção some quando vazia.
- Confirmações independentes por dia, com opção de marcar como não vista, editar e excluir com confirmação.
- Preferência global para contabilizar a duração ao concluir manualmente, desativada por padrão.
- O check completa apenas o tempo que falta, evitando duplicação; desfazer retira só o acréscimo manual e mantém o tempo real do cronômetro.
- Notas, confirmações e tempo manual incluídos nos backups; dados anteriores preservados.
- Meu dia acompanha a virada da data quando está mostrando o dia atual, inclusive com o cronômetro parado.
- Edições de cadernos e notas são salvas sem aguardar o intervalo do cronômetro ativo.

## 0.4.4

- Área Cadernos independente dos planos de estudo, com vários cadernos e páginas.
- Capas opcionais por imagem, cores e ícones; edição e exclusão com confirmação.
- Seletor de cor personalizada junto às cores pastéis, 24 ícones e opção Sem ícone, inclusive em capas com imagem.
- Índice de páginas atualizado pelos títulos e índice clicável dos títulos dentro de cada página.
- Editor com negrito, itálico, tamanho de fonte, títulos, listas, desfazer/refazer e atalhos Markdown para títulos (`#`, `##`, `###`).
- Imagens, prints e rabiscos intercalados com o texto, reutilizando o editor das anotações.
- Dados anteriores preservados; cadernos, capas e formatação incluídos nos backups locais.
- Botão de maximizar com o quadrado padrão do Windows.
- Botão do modo compacto reduzido a um ícone discreto com identificação ao passar o mouse.
- Modo compacto fixo em 340 × 112 px, sem redimensionamento, preservando a última posição e restaurando o tamanho normal ao expandir.

## 0.4.3

- Anotações em documento contínuo: texto, prints, imagens e rabiscos intercalados na posição do cursor.
- É possível continuar escrevendo após cada imagem e inserir novos trechos antes ou entre os existentes.
- Inserção de imagens por colagem, arquivo ou arraste, com desfazer/refazer e remoção individual.
- Notas anteriores preservam texto, imagens, vínculo com aula, data e fixação; o formato contínuo é salvo ao editar.
- Editor carregado apenas ao abrir uma nota, mantendo a inicialização do app leve.
- Modais impedem a rolagem do aplicativo ao fundo, mantendo a rolagem no conteúdo aberto.
- Filtro por data junto à busca de notas, combinável com o texto pesquisado e com opção de limpar.

## 0.4.2

- Preferências organizadas em Aparência, Geral, Backup e Atualizações.
- Seleção visual de tema e correção das cores dos selects e opções no modo escuro.
- Temas personalizados prontos em rosa, azul, verde e roxo, com cores de texto e botões verificadas para leitura.
- Opção de fixar e desafixar notas, mantendo as fixadas no topo do caderno e das prévias.
- Imagens coladas próximas do texto, sem o espaço mínimo excessivo do editor.
- Botão de remover posicionado dentro da borda de cada imagem, inclusive nas menores.
- Janela compacta memoriza posição e tamanho, inclusive após reabrir o app, com recuperação quando um monitor é desconectado.
- Resumo de Meu dia unificado em blocos: aulas e descansos entram na quantidade concluída e na meta. O tempo de foco continua contando apenas estudo.

## 0.4.1

- Caderno de anotações ampliado, com busca, lista recolhível e editor preparado para textos longos.
- Nova anotação no cabeçalho; data e vínculo com aula disponíveis em Detalhes, sem ocupar o editor por padrão.
- Ícone próprio de caderno e prévia recolhível das últimas anotações nos planos.
- Exclusão pelo botão da nota, com confirmação separada e preservação das demais notas.
- Arraste de aulas no editor de plano restrito à alça da esquerda, permitindo selecionar texto normalmente nos campos.
- Regra do projeto para solicitar confirmação de encerramento do lote antes de commit, push ou Release e incrementar PATCH por padrão.
- Atualizações em segundo plano, sem repetir o assistente, com reinício automático; a instalação inicial continua guiada.
- Versão do aplicativo exibida discretamente abaixo da logo na sidebar.

## 0.4.0

- Instalador assistido em português com apresentação, escolha da pasta, confirmação e tela de sucesso com opção de abrir o aplicativo.
- Novos perfis seguem o tema do dispositivo; escolhas manuais são preservadas e o modo automático pode ser restaurado nas preferências.
- Primeiro uso sem planos pré-cadastrados: tutorial curto para criar um plano com Aula 1, Descanso e Aula 2.
- Alternância entre cards e lista em Planos de estudo, com a escolha salva.
- Ajuste da janela compacta para permanecer sobre as outras janelas no Windows.
- Preservação de planos, histórico, anotações e preferências existentes na atualização.

## 0.3.0

- Interface mais compacta por padrão, com opções Mínimo, Compacto e Confortável nas preferências.
- Remoção de textos motivacionais e descrições repetidas para mostrar mais aulas na tela.
- Edição individual de nome e duração das aulas e descansos pelo lápis na própria linha.
- Verificação de atualizações ao abrir, download após confirmação e instalação com preservação dos dados locais.
- Verificação SHA-256 do instalador baixado.
- Repositório público e link fixo para baixar o instalador da versão mais recente.

## 0.2.0

- Modo compacto de 340 × 112 px, com título e controles essenciais.
- Tema escuro em preto e cinzas neutros, efeito de vidro e alternância de tema.
- Ícone próprio e versão de abertura direta para evitar extração em cada inicialização.

## 0.1.0

- Planos de estudo com dias da semana, aulas, descansos, duplicação e reordenação.
- Cronômetro com pausa, conclusão automática e aviso sonoro.
- Caderno com imagens e rabiscos, métricas de estudo e backup local.
