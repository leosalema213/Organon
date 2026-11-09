# Contexto do Organon para novos chats

Resumo de passagem de contexto em 28/10/2026. Confirme o estado atual do Git antes de trabalhar; este documento não substitui o código ou os testes.

## Projeto e estado confirmado

- Pasta: `C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop` (dentro do projeto Codex Pessoal).
- Repositório: https://github.com/leosalema213/Organon.git, branch `main`.
- Última publicação confirmada: **0.4.8**, commit `61b34ad737f917fef309bc4b92f806dbc5319d86`.
- Instalador atual: https://github.com/leosalema213/Organon/releases/latest/download/Organon-Instalar.exe.
- App Windows local em JavaScript, React, Vite e Electron; editor Tiptap; ícones Lucide. Funciona sem conta ou servidor.
- Marca: Organon. Logo atual: organon com o primeiro o como ômega invertido; ícone próprio.
- Documentação principal: `README.md`, `CHANGELOG.md`, `PENDENCIAS.md` e regras em `AGENTS.md`.

## Regras importantes

- Mudanças incrementais e localizadas; preservar alterações de outros chats e o perfil pessoal.
- Antes de commit, push, tag ou release, perguntar se o usuário terminou os ajustes e autoriza publicar; aguardar confirmação explícita para o lote atual.
- Por padrão, incrementar somente PATCH. Não aumentar a versão por uma investigação sem mudança no produto.
- Testes devem usar perfis temporários `--user-data-dir`, nunca importar dados de teste sobre os dados reais, desinstalar ou reinstalar o aplicativo pessoal automaticamente.
- Não expor credenciais. Não registrar aplicativos de teste na inicialização do Windows ou gerar notificações reais durante testes.
- Sem agentes adicionais ou novos chats por iniciativa própria; só quando autorizado pelo usuário ou por instruções aplicáveis.

## Dados e compatibilidade

- Perfil principal: `%APPDATA%\compasso-estudos\compasso.json`; existe compatibilidade com o perfil antigo `Compasso`. A renomeação não deve criar um perfil vazio.
- Pacote atual: `organon`. Identificadores deliberadamente legados: appId instalado `br.com.compasso.estudos`, arquivo `compasso.json`, chave web `compasso-v1` e detecção do registro de inicialização antigo. O registro atual passa a usar `Organon`, preservando a preferência de desativação do Windows.
- Modelo de dados versão 1, ampliado com campos opcionais e migrações para backups antigos. Não confundir versão do modelo com a versão do aplicativo.
- Persistência JSON por arquivo temporário e substituição; gravações do timer são limitadas a checkpoints, outras edições devem salvar prontamente.
- A aplicação em navegador usa armazenamento separado do desktop.
- Conferir no código o que é exportado: não assumir que opções locais da janela, arquivos de cache ou registro do Windows fazem parte do backup.

## Funcionalidades existentes

- Planos com dias da semana, aulas e descansos reordenáveis, nome, duração, ícone e cor personalizados; duplicação, edição individual, conclusão de curso e reabertura.
- Meu dia filtra planos agendados e ativos; check diário de todos os blocos. Métricas de foco excluem descansos; histórico semanal e mensal e planos concluídos.
- Timer: play/pausa, conclusão automática com som, próximo bloco sempre manual, suspensão pausa; reinício restaura pausado. Preferência para creditar duração ao marcar manualmente, sem duplicar tempo real.
- Janela compacta fixa 340×112, posição lembrada, sempre acima; botão + oferece 2, 3 e 5 minutos à aula atual, sem alterar a programação futura. Aula concluída reabre pausada; descanso não recebe tempo extra.
- Anotações ligadas a planos: editor contínuo com texto, imagens/prints e desenhos na posição do cursor; busca, data, fixação e exclusão confirmada.
- Cadernos independentes: capa com cor/imagem e ícone opcional, várias páginas, índice por títulos, rich text (negrito, itálico, tamanhos, headings, listas), imagens e rabiscos.
- Área Notas é distinta das anotações dos planos: lembretes com título/descrição, data ou recorrência diária, vistos por dia, opção Lembrar-me; destaque em Meu dia e notificação agrupada ao abrir.
- Preferências em abas: tema sistema/claro/escuro/paletas, densidade, configuração geral, backup e atualizações. Iniciar com Windows é true por padrão; Lembrar-me é false.

## Arquivos e testes de referência

- `src/model.js`: estado, timer, registros, validação/migração e utilitários de backup. `src/App.jsx`: fluxos, persistência e integração desktop.
- `src/Preferences.jsx`, `src/Reminders.jsx`, `src/reminders.js`, módulos de cadernos e editor: conferir com `rg --files src`.
- `electron/main.cjs`: leitura/gravação local, IPC de importação/exportação, janelas, inicialização e atualizações. `electron/preload.cjs`: APIs expostas ao renderer.
- `electron/branding.cjs`, `electron/updates.cjs`, `electron/startup.cjs`, `electron/reminder-notifications.cjs`: identidade, atualizador e integrações Windows.
- `npm test` passou em 74 testes no lote 0.4.8; isso não é prova de cobertura completa do backup das novas funcionalidades.
- `npm run build`; testes Electron `test:ui`, `test:notebook`, `test:library`, `test:reminders`, `test:plans`, `test:windows-startup`.
- Scripts adicionais: `node tests/extra-time.cjs`, `node tests/update-cleanup.cjs`. Testes desktop aceitam `ORGANON_EXECUTABLE` (com alias legado aceito) em vários scripts; conferir cada um.
- `tests/model.test.js`, testes de cadernos e lembretes já têm verificações de roundtrip; auditar também os caminhos reais de exportar/importar pela UI e os campos recentes.

## Atualizações e Windows na 0.4.8

- Atualizador consulta GitHub, verifica tamanho e SHA-256, pede aprovação, baixa, instala silenciosamente e reinicia. Scripts: `npm run dist`, `npm run checksums`, `npm run release`.
- Releases incluem Organon-Instalar.exe e cópia idêntica Compasso-Instalar.exe para clientes antigos, com checksums. Não remover o alias sem avaliar compatibilidade.
- Limpeza após abertura e persistência bem-sucedidas: remove somente arquivos conhecidos do cache de versões instaladas/anteriores; preserva futuras, desconhecidos e links, tenta novamente após 30s se bloqueado. Nunca limpa Downloads do navegador.
- Conflito local identificado: atalhos Electron e Organon tinham o mesmo AppUserModelId. Desenvolvimento agora usa `.development`; atalho Electron legado só é reidentificado se corresponde ao ID do app e aponta para electron.exe.

## Nova tarefa solicitada para outro chat

1. Auditar e validar exportação/importação completas antes de o usuário reinstalar. Cobrir planos e blocos, histórico e tempo manual, timer/tempo extra, anotações antigas e documentos atuais, imagens e desenhos, fixação, cadernos/capas/páginas/formatação, notas/lembretes/vistos, configurações e migrações. Inventariar exclusões intencionais e limites. Testar em perfil limpo, reiniciar e comparar dados semanticamente; corrigir perdas comprovadas, preservando compatibilidade. Não prometer restauração perfeita antes da evidência nem reinstalar o app pessoal.
2. Avaliar integração com Google Drive: comparar selecionar uma pasta local sincronizada pelo Drive para desktop com conexão OAuth/API dentro do Organon. O usuário imagina Conectar com Drive, pasta Organon selecionável/criada e subdivisões de notas e cadernos. Explicar diferença entre backup integral restaurável e cópias separadas para navegação, evitando fragmentar o backup sem necessidade. Pesquisar documentação oficial atual, requisitos de OAuth desktop, permissões, armazenamento seguro de tokens, configuração no Google Cloud, custos/limites, offline e conflitos. Apresentar recomendação e o que depende do usuário antes de implementar uma integração de nuvem completa.

O usuário pediu expressamente que essa investigação e execução ocorram no novo chat, mantendo este somente como histórico.
