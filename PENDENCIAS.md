# Lote aberto após a versão 0.4.3

Não comitar nem publicar este lote até o usuário encerrar os pedidos e confirmar a publicação, conforme AGENTS.md.

- [x] Trocar o ícone de maximizar da janela principal pelo quadrado padrão do Windows.
- [x] Reduzir o botão do modo compacto a um ícone de 30 × 30 px, com tooltip, no player atual.
- [x] Fixar a janela compacta em 340 × 112 px, sem redimensionamento; manter movimentação e posição salva.
- [x] Criar a área Cadernos, com capas e ícones, páginas, índice automático, formatação, imagens e desenhos.
- [x] Adicionar cor personalizada, mais ícones e opção Sem ícone aos cadernos.
- [x] Usuário autorizou encerrar e publicar a 0.4.4 antes do próximo lote.

## Próximo lote (após publicar a 0.4.4)

- [x] Notas com título, descrição, dia específico ou recorrência diária; exibir em Meu dia e ocultar ao marcar como vista.
- [x] Preferência global, desativada por padrão, para contabilizar a duração cadastrada ao concluir manualmente um bloco.
- [x] Escolha de ícone e cor para planos, com biblioteca ampla e busca compartilhada com cadernos.
- [x] Abrir a biblioteca de ícones em popup separado, mantendo a edição do plano ou caderno aberta.
- [x] Concluir e reabrir planos, filtros por situação e indicadores de planos concluídos no progresso.
- [x] Usuário autorizou encerrar e publicar a 0.4.5.

## Próximo lote

- [x] Preferência de iniciar com o Windows, ativada por padrão.
- [x] Opção Lembrar-me nas notas, desativada por padrão, e notificação ao abrir com notas pendentes.
- [x] Adotar Organon e a segunda proposta de logo, com ômega invertido, preservando dados e atualizações anteriores.
- [x] Adicionar +2, +3 e +5 minutos à aula atual pelo modo compacto, preservando a janela e as métricas.
- [x] Usuário autorizou encerrar e publicar a 0.4.6.

## Lote 0.4.7

- [x] Aplicar o símbolo do Organon à janela e à barra de tarefas do Windows.
- [x] Usuário autorizou encerrar e publicar a 0.4.7.

## Lote 0.4.8

- [x] Limpar instaladores de atualizações concluídas e o cache antigo, preservando downloads futuros e dados pessoais.
- [x] Separar a identidade do Electron de desenvolvimento e corrigir o atalho legado conflitante.
- [x] Usuário autorizou encerrar e publicar a 0.4.8.

## Ideias e correções futuras

Registro para acumular pedidos; implementar somente quando o usuário solicitar. Manter os itens em checklist e marcar como concluídos apenas após implementar e validar.

- [x] **Próximo lote, após publicar a transição de repositório: sugestões de correção ortográfica no botão direito.** Usar o corretor nativo do Electron, sem biblioteca pesada, para sugerir e substituir palavras sublinhadas em vermelho nos campos editáveis de texto (cadernos, notas e demais editores). Conferir português do Brasil, disponibilidade/download e uso offline do dicionário, palavra sem sugestão e menus já existentes; excluir senhas e campos sem texto. Preservar seleção, mídia, formatação, HTML importado e desfazer/refazer; considerar adicionar/remover palavras do dicionário pessoal. Viabilidade confirmada na API `context-menu`/`dictionarySuggestions`/`replaceMisspelling`. Concluído na 0.7.2: provedor oficial do Electron com Hunspell e dicionário pt-BR locais no Windows. Testes focados e fluxo de interface aprovados, preview 0.7.2-preview.1 aceito e publicação autorizada pelo usuário. Referência: https://www.electronjs.org/docs/latest/tutorial/spellchecker/.

- [x] Adicionar a opção de aumentar o tempo da tarefa no player da janela principal (modo normal/tela cheia), com os mesmos incrementos disponíveis no modo compacto. Hoje o botão de adicionar minutos só aparece no modo compacto; na janela principal há apenas resetar, iniciar/pausar e entrar no modo compacto. Permitir adicionar tempo sem precisar trocar de modo. Implementado no lote 0.5.8; testes de acréscimo aprovados pelo usuário em 03/11/2026.
- [x] Organizar o cadastro em etapas, solicitando nome e apelido obrigatórios no início do fluxo, antes de concluir o cadastro. Oferecer foto de avatar opcional, com opção de pular, sem deixar a identificação básica somente para a edição posterior do perfil.
- [x] Retirar notificações e convites de dentro da tela de Equipes e reuni-los em uma central acessível por um sininho, preferencialmente na barra superior, com pop-up. Permitir excluir notificações individualmente, marcar todas como lidas e excluir todas; preservar as ações de responder aos convites.
- [x] Mostrar os membros pertencentes à equipe tanto para o administrador quanto para os usuários convidados. Reorganizar a tela de Equipes com abas que separem suas funções, mantendo o padrão compacto de espaçamento, tipografia e componentes do aplicativo.

- [x] **Anki → Explorar — filtrar cartas por data de criação e listar as mais recentes primeiro.**
  - **Interface.** Em `src/Anki.jsx`, adicione um campo de data compacto com identificação acessível, à direita do filtro de baralho, na mesma barra `.books-filters.anki-search`. Use o padrão de `src/density.css` e ajuste `src/anki.css` só se necessário para o alinhamento e a quebra de linha em janela estreita. O campo começa vazio (todas as datas), permite escolher um dia do calendário local e tem uma forma clara de limpar. Combine data, busca textual e baralho. Mantenha a data no estado da tela.
  - **Lista.** Derive a lista em Explorar, sem alterar `a.cards`. Ordene por criação decrescente mesmo com filtros ativos. Preserve a ordem original nos empates e deixe cartas sem data conhecida no fim quando o campo estiver vazio. Com um dia escolhido, mostre somente cartas com data conhecida daquele dia. Compare a data no fuso local, inclusive nas viradas do dia. Mantenha as ações existentes de abrir a nota e suspender/reativar a carta.
  - **Origem da data.** Em `src/anki.js`, registre `createdAt` em milissegundos em `newCard`, separado de `position`. O `NoteEditor` usa `newCard` também no fluxo do leitor e para novas omissões de uma nota existente. Editar, mover, suspender ou revisar uma carta existente deve preservar sua data. Para importadas, use o ID original da carta em `card.source.id` quando for um timestamp válido. Para locais antigas, use `position` somente quando corresponder a um timestamp válido da inserção sequencial. O modo aleatório de `NoteEditor` usa `Math.random() * 1e12`, então descarte esses valores menores que `1e12` no fallback local. Trate valores ausentes ou inválidos como data desconhecida. Evite usar `due`, `lastReview` ou a data de importação como data de criação.
  - **Compatibilidade.** Mantenha `createdAt` opcional para perfis e backups antigos e documente o contrato e os fallbacks em `docs/DADOS-E-MIGRACOES.md`. Confira a ida e volta pelo backup e pelo serializador do snapshot. Preserve IDs, `position`, agendamento e histórico. A alteração cabe no snapshot existente, sem DDL.
  - **Aceite.** Verifique a ordem ao abrir Explorar, a seleção e a limpeza da data, a combinação com busca e baralho, a virada de dia no horário local e cartas sem data recuperável. Confira criação com inserção sequencial e aleatória, criação pelo leitor, importação/reimportação e edição de carta existente. Valide o encaixe da barra em janela estreita. Entregue ao usuário um único comando PowerShell focado, com caminho absoluto, para a validação no terminal dele. Marque o item como concluído só após implementação e validação.
