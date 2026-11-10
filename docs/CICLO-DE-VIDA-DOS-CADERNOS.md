# Cadernos compartilhados e seleção em lote

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
