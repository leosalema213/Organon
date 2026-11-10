# Cadernos compartilhados e seleção em lote

## Cabeçalho comum e edição automática — 10/11/2026, novo lote

Atualização após preview.1: a instância de texto aberta aplica as revisões externas sem remontar a página ou emitir eco de salvamento. Uma consulta da revisão/permissão a cada 3 s recupera avisos perdidos. Recebimentos durante gravação são consultados novamente ao concluir. Quando houver rascunho, alterações independentes são combinadas antes de atualizar a tela; conflitos no mesmo conteúdo continuam preservados. A indicação discreta de editor recente depende do SQL `notebook-live.sql`, ainda não aplicado, e representa a última edição confirmada nos últimos 5 s. Ambos os computadores precisam da próxima versão do preview; cópias pessoais baixadas continuam independentes.

O recebido usa o mesmo cabeçalho do pessoal: seta, capa/título, indicação discreta de compartilhamento e ações à direita. Quem pode editar vê o ícone Editar e Nova página; leitura mantém os campos desabilitados. Baixar cópia fica na mesma linha. Não há modo separado “Editar caderno compartilhado” nem botão para salvar o documento; a modal de nome/aparência mantém as ações normais do caderno.

Alterações começam a ser enviadas em até 500 ms após a primeira edição pendente, mesmo em digitação contínua, com intervalo mínimo de 500 ms entre envios. Cada envio consulta autorização e revisão atuais, aguarda imagens e grava pela RPC existente. Digitação durante o envio continua na fila. Voltar e baixar cópia aguardam a gravação pendente; falha mantém o caderno aberto e oferece nova tentativa/recuperação do rascunho. O rascunho local por conta sobrevive a navegação e reinício; não equivale a publicação ou backup pessoal. Baixar cópia do rascunho cria outro caderno, com IDs novos, antes de recarregar o remoto.

Invalidações de Equipes, foco e reconexão atualizam a leitura sem desmontar o editor. O autor também abre a publicação e recebe as revisões confirmadas no original pessoal. Edições independentes por campo/página são combinadas antes de enviar; alterações concorrentes no mesmo campo/documento ou exclusão de página alterada interrompem a gravação e preservam o rascunho. Conflitos de revisão durante o envio têm no máximo duas novas consultas/tentativas, sempre recalculando a combinação. Isso é atualização automática por revisão/Realtime existente; não é coedição de caracteres com cursores simultâneos. Revogação impede novos envios no servidor e mantém a recuperação local do trabalho ainda pendente.

Na modal de compartilhamento, cada pessoa tem Pode ler/Pode editar. A escolha vale só para os recursos selecionados. Em lote com permissões diferentes aparece Varia por recurso; só uma escolha explícita uniformiza o acesso. Remarcar destinatários preserva a edição anterior quando não se escolhe outra opção. Rever permissões usa as mesmas exceções por recurso. Proprietário/autor continuam administrativos; livros usam o mesmo componente e contrato. Publicações em equipes diferentes continuam independentes, assim como cópias pessoais baixadas pelos destinatários.

SQL adicional e testes estão preparados e pendentes, conforme DADOS-E-MIGRACOES.md. A validação remota do contrato anterior permanece válida para aquele contrato, sem validar automaticamente estas mudanças.

## Ajuste de destinatários — 10/11/2026

Livros e cadernos usam o mesmo seletor: marcar equipe escolhe todos os membros aceitos atuais; os checkboxes permitem restringir pessoas. Reabrir mostra o acesso efetivo. Alterar os destinatários não reenvia o conteúdo, mas exige revisão e token atuais. O proprietário é indicado como acesso administrativo fixo. Equipes → Rever permissões consulta/edita as mesmas concessões; exceções ao escopo Todos preservam o acesso aos outros recursos e aos futuros. A aplicação remota desse contrato está pendente em DADOS-E-MIGRACOES.md.

Na edição do caderno, o ícone Compartilhar fica no cabeçalho, antes de Fechar. Ele salva primeiro as alterações locais; erro de salvamento mantém a edição aberta. Cancelar/Salvar ficam no rodapé, com exclusão à esquerda. A capa recebida é resolvida separadamente para o cartão; abrir o caderno continua resolvendo o conteúdo completo.

## Criar, consultar e compartilhar

O caderno pessoal mantém o editor e o salvamento existentes. No editor de dados do caderno, Compartilhar salva primeiro o estado local antes de consultar os espaços. O menu de compartilhamento mostra as publicações atuais e permite marcar/desmarcar cada equipe. Criar/aceitar equipes e gerenciar as permissões continua em Equipes.

Ao lado de Novo caderno e Importar livros há um botão de compartilhamento em lote. É possível selecionar itens pessoais individuais ou todos os atuais e escolher um ou mais espaços. Um destino parcialmente publicado tem estado intermediário. Marcar completa as publicações ausentes; desmarcar retira somente as publicações da pessoa autenticada. Conteúdo recebido precisa de cópia pessoal antes de ser republicado em outro espaço. “Todos” não cria uma assinatura para publicar novos recursos futuros.

## Receber e editar

A lista de Cadernos consulta todos os espaços autorizados, agrupa o mesmo caderno pelo ID e mostra um indicador com os espaços. Original/cópia pessoal prevalece sobre a publicação recebida. Os livros continuam agrupados por hash do arquivo. A notificação de caderno abre Cadernos; não existe mais uma tela separada de compartilhados nem obrigação de trocar o ambiente.

O conteúdo recebido usa openResource no processo principal, conferindo a sessão e as permissões e resolvendo imagens privadas. Leitura é somente leitura por padrão. Com permissão de escrita, Editar caderno compartilhado habilita um rascunho no mesmo editor dos pessoais. Salvar verifica a revisão original. Conflito/falha mantém o rascunho; Descartar consulta a publicação atual novamente. Sair pelo botão de retorno durante a edição pede descarte explícito. Uma retirada de acesso elimina o item recebido da lista.

## Baixar cópia, retirar e excluir

Baixar cópia reabre o recurso autorizado, valida o conteúdo e persiste os campos pessoais, com texto, páginas, capa e imagens. IDs estáveis evitam duplicar o cartão; a cópia não tem vínculo remoto de exclusão e não é atualizada por alterações da publicação. A persistência utiliza o snapshot/backup/sincronização existentes. Falha de gravação é informada e permite repetir; cópia já existente não é sobrescrita.

Desmarcar um espaço no compartilhamento remove as publicações da pessoa autenticada nesse destino. Excluir o original consulta todos os espaços atuais, retira todas as publicações próprias e só então exclui o caderno local. Se houver falha de consulta/retirada, o original local é preservado. Uma nova tentativa consulta revisões atuais e continua as retiradas restantes. Se só a gravação local falhar após as retiradas, o aviso diferencia esse caso. Excluir uma cópia recebida e salva pela pessoa não retira publicações alheias.

Destinatários sem cópia pessoal perdem o recurso quando a publicação some ou o acesso é revogado. Quem baixou a cópia continua com o conteúdo pessoal. Sem conexão, não se promete revogação instantânea de uma tela já carregada: invalidações existentes, foco da janela e reconexão consultam novamente o servidor. Permissões reais permanecem no backend, não nos checkboxes da interface.

## Falhas e validação

Operações em lote são independentes por recurso/espaço. Sucessos não são revertidos por uma falha posterior; os erros indicam item e equipe. Após a falha, o catálogo é consultado novamente e somente operações pendentes são repetidas. O botão fica bloqueado durante a gravação. Trocar de conta desmonta a biblioteca e seus modais; respostas antigas não escrevem no estado de outra conta.

Testes preparados: identidade/autoria/seleção/revisões e cópia independente em shared-resources.test.js; regressão dos livros em sharing-ui.cjs; fluxo de cadernos, lotes, falhas parciais, conflito, retirada e persistência em notebook-sharing.cjs. Interface usa IPC sintético em perfil temporário, com rede bloqueada. Servidor e entrega real entre contas precisam de validação específica pelo usuário; não houve DDL neste lote.
