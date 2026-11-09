# Auditoria de backup — 28/10/2026

## Resultado e alcance

Base auditada: release 0.4.8, commit `61b34ad737f917fef309bc4b92f806dbc5319d86`. As correções estão incluídas na 0.4.9. O resumo `CONTEXTO-PROJETO.md` preexistente foi preservado como registro histórico.

**A 0.4.8 não restaura literalmente todos os dados:** descarta a sessão do cronômetro ao importar, incluindo duração ampliada e tempo restante. O histórico de tempo já estudado continua intacto. Também exporta arquivos maiores que 40 MiB, mas bloqueia sua importação. Ambos foram reproduzidos no fluxo Electron antes da respectiva correção.

Na versão corrigida, o teste compara todo o JSON exportado com a origem, importa pela interface em um perfil sem arquivo de dados e compara todo o estado persistido. Fecha e abre o aplicativo e compara novamente, admitindo apenas a renovação de `active.startedAt`; a sessão continua pausada. A prova usa dados sintéticos representativos; não foi aberto, lido ou modificado o perfil pessoal e não foi executada desinstalação/reinstalação. Não é uma garantia sobre qualquer arquivo corrompido, tamanho ilimitado ou versão futura.

## Inventário verificado

| Área | Campos e comportamentos preservados |
| --- | --- |
| Planos | IDs, ordem, nome, descrição, dias, ícone, cor personalizada, data de conclusão, blocos/aulas/descansos e suas durações |
| Anotações de planos | IDs, datas, vínculo com bloco, fixação, texto legado e anexos; documento atual, ordem entre texto e imagens |
| Cadernos | IDs, nomes, ícone opcional, cor, capa em imagem ou ausente, ordem e múltiplas páginas |
| Páginas | Título inclusive vazio, data, texto, imagens legadas, documento com títulos, negrito, itálico, tamanho de fonte, listas, quebra de linha e imagens intercaladas |
| Rabiscos e prints | São imagens PNG/JPEG/WebP embutidas em base64 no documento; não dependem de arquivo externo. Criação real de rabisco e inserção de imagens também exercitadas nas suítes de interface |
| Notas/lembretes | IDs, título, descrição, data ou recorrência diária, `seenDates` com múltiplos dias, opção `notifyOnStartup` |
| Histórico | Tempo real e manual, checks, tipos, nomes registrados e registros de planos já excluídos |
| Timer | Plano/bloco/data, nomes, tipo, total e restante, acréscimo de cinco minutos; importação e reinício pausados |
| Preferências | Som, iniciar com Windows, crédito manual, tema, paleta, densidade, exibição dos planos |
| Metadados | Versão 1 do modelo, data de criação e tutorial concluído |

Todo o estado principal é serializado; imagens/capas/desenhos estão dentro do JSON. `validateData` preserva planos, documentos, cadernos, lembretes e registros, acrescenta coleções ausentes em backups antigos e normaliza as preferências conhecidas. Campos de preferências desconhecidos não têm garantia de preservação; não correspondem a funcionalidades atuais. Backups antigos sem ícone, biblioteca ou lembretes também foram importados pela interface.

## Correções locais

1. `validateData` preserva a sessão válida com `running: false` e verifica vínculo, data, tipo e durações. Uma sessão de plano finalizado continua sendo descartada, pois o plano já foi encerrado.
2. Remove o bloqueio de importação de 40 MiB. Arquivos continuam sujeitos à memória e ao parser JSON; não foi estabelecida capacidade ilimitada. Testado com aproximadamente **41 MiB**, acima do antigo limite; o tamanho exato está no relatório da execução.
3. Exportação recebe um snapshot atual do renderer, contabilizando o timer até o clique. Antes, `persist` podia retornar false e o Electron copiava silenciosamente o arquivo antigo. O novo teste injeta falha de gravação no IPC: altera uma preferência na interface e comprova que a cópia exportada contém a alteração, enquanto o arquivo local permanece antigo.
4. A mensagem de restauração concluída aguarda a gravação. Se ela falhar, o app informa que os dados foram carregados mas não salvos; a exportação continua disponível para recuperação.

## Exclusões e diferenças intencionais

- Timer não retoma sozinho e tempo com o app fechado não é creditado. `startedAt` é renovado ao abrir; total, restante e histórico persistem.
- `window-state.json` (posição da janela compacta), caches, instaladores, atalhos e registro do Windows não fazem parte do backup. A preferência de inicialização é incluída, mas a inscrição no Windows depende da execução instalada e das escolhas do sistema.
- Seleção de tela/data, filtros, rolagem, modal aberto, cursor, seleção e pilha temporária de desfazer/refazer são estados da sessão de interface, fora do modelo persistido. O conteúdo e a formatação do documento são incluídos.
- Rascunhos de formulários ainda não confirmados e desenho ainda não inserido precisam ser salvos antes de exportar. Conteúdo já aplicado no editor entra no estado do aplicativo.
- Instalação web e desktop usam armazenamentos distintos. O JSON transporta os dados; caches do navegador não são transportados.
- Importar substitui o estado atual depois da confirmação; não mescla dois perfis. Registros históricos já preservados de planos excluídos entram no backup, mas conteúdo efetivamente excluído antes da exportação não reaparece.
- O JSON não é criptografado. Mantenha as cópias em locais de sua confiança.

## Evidências reproduzíveis

`npm run test:backup` executa `tests/backup.cjs`. Somente os seletores nativos de arquivo são substituídos para apontar a arquivos temporários. Os botões de Preferências, confirmação, validação, preload, IPC, leitura, escrita e reinício são os da aplicação. Os dados representativos são preparados diretamente no perfil fonte; as suítes adicionais criam e editam dados pela UI.

O teste inclui comparação integral na exportação, importação em perfil limpo, comparação após reinício, visualização do timer pausado e página formatada, arquivo acima de 40 MiB, migração antiga, cancelamento, JSON inválido sem substituição e exportação diante de falha local simulada. Não registra inicialização nem dispara notificações reais; `--user-data-dir` isola os perfis. O teste pode usar `ORGANON_EXECUTABLE` (com alias legado aceito) para validar uma compilação empacotada.

Evidências locais não versionadas: `test-output/backup-audit.json`, `backup-restored.png` e `backup-page-restored.png`. O JSON informa a pasta temporária com os backups e perfis sintéticos da última execução. As imagens da suíte de cadernos/anotações documentam criação e renderização de rabiscos e formatação.

Validações executadas: 75 testes de modelo/integrações, build Vite, `test:backup` em desenvolvimento e no executável empacotado, `test:notebook`, `test:library`, `test:reminders`, `test:ui`, `test:plans`, `test:windows-startup`, `test:installer` e geração local NSIS. O teste do instalador executa um programa NSIS mínimo com as mesmas macros, sem instalar o app. Testes de inicialização/notificação usam adaptadores simulados; não foi feito login/reinício do Windows nem testada uma instalação real sobre os dados pessoais.

## Reinstalação segura

1. Termine e salve formulários e rabiscos; pause o timer. Em Preferências → Backup, exporte para uma pasta fora da instalação. Guarde outra cópia em outro local. Use nomes com data, evitando sobrescrever a única cópia boa.
2. Feche o Organon. Copie também `%APPDATA%\compasso-estudos\compasso.json` para uma pasta separada; se sua instalação ainda usa o perfil legado `Compasso`, preserve o arquivo dessa pasta. Essa cópia é especialmente importante na 0.4.8 para resguardar a sessão que o importador antigo descarta. Não mova nem apague a origem.
3. Confira existência, tamanho e data das cópias. Para a garantia do seu backup específico, importe uma cópia em um perfil temporário e confira notas, cadernos/imagens e histórico; feche/reabra esse perfil. Não teste por cima dos dados pessoais. Exemplo para a compilação em pasta: `Organon.exe --user-data-dir="C:\caminho\perfil-teste-organon"` (pasta nova, com o app pessoal fechado).
4. Use a versão corrigida 0.4.9 ou posterior para preservar também o timer e aceitar arquivos acima de 40 MiB. Confira a versão nas preferências. O instalador está disponível nas Releases vinculadas no README; a compilação local fica em `release/0.4.9/Organon-Instalar.exe`.
5. Só após confirmar as cópias, faça a reinstalação desejada. O instalador está configurado com `deleteAppDataOnUninstall: false`, mas mantenha as cópias independentes. Se os dados já aparecerem ao abrir, confira antes de importar novamente.
6. Se precisar restaurar, use Preferências → Backup → Importar backup, confirme e aguarde sucesso sem erro de salvamento. Confira o conteúdo e feche/reabra. Mantenha as cópias até concluir essa conferência.

Nenhuma instalação ou reinstalação do aplicativo pessoal foi executada durante a auditoria.
