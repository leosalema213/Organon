# Ciclo de vida dos livros

## Biblioteca e compartilhamento

- **Importar** inclui um livro no catálogo pessoal. **Compartilhar livro** publica uma cópia em cada espaço selecionado. Dentro do espaço, o acesso de cada membro é definido em **Equipes → Rever permissões**.
- **Desmarcar um espaço e salvar** retira as publicações feitas pela sua conta naquele espaço. Publicações feitas por outra pessoa continuam sob o controle dela. Destinos que falharem ficam disponíveis para uma nova tentativa.
- A biblioteca agrupa as entradas pelo hash do arquivo. Quando há uma cópia pessoal, o cartão usa o título, o progresso e os planos dessa cópia. O ícone indica que o mesmo arquivo ainda está disponível por compartilhamento.
- Abrir um livro compartilhado pode baixar o arquivo para leitura e geração da capa. **Baixar cópia**, no menu do cartão, é a ação que o inclui na biblioteca pessoal, com um novo ID e o progresso do leitor naquele momento. O livro entra no backup e na sincronização pessoal como um livro importado.

## Retirada e exclusão

| Ação | Quem publicou | Quem recebeu |
| --- | --- | --- |
| Retirar de um espaço | Mantém o original pessoal e as publicações nos outros espaços | A cópia compartilhada some desse espaço. Uma cópia pessoal já salva permanece. |
| Excluir o original com a conta conectada | O app consulta os espaços, retira as publicações da conta e só então exclui o original da biblioteca | O livro some se nenhuma publicação autorizada ou cópia pessoal continuar disponível. |
| Excluir um compartilhamento sem original local | O menu do cartão permite retirar as publicações antigas da própria conta | Vale a mesma regra de retirada. |
| Excluir uma cópia pessoal recebida | O app remove a cópia da biblioteca de quem a salvou | A publicação de outro autor continua disponível enquanto houver permissão. |

As operações remotas usam a revisão de cada publicação. Se uma consulta ou retirada falhar durante a exclusão do original, a biblioteca mantém o livro para uma nova tentativa. Retiradas que já deram certo permanecem aplicadas. Sem uma conta conectada, a exclusão local não consegue retirar publicações remotas. Ao entrar novamente, o autor pode retirar uma publicação que tenha ficado sem original pelo menu do cartão.

## Validação

- Com duas contas, publicar um livro, confirmar o acesso do destinatário e retirar um dos espaços. Conferir a marcação ao reabrir a modal e a atualização da biblioteca do destinatário.
- Excluir o original com compartilhamentos ativos e verificar que o destinatário perde o livro se não tiver uma cópia pessoal. Repetir depois de **Baixar cópia** e conferir que o livro permanece legível e sem cartão duplicado.
- Verificar também o caso de uma publicação antiga cujo original já foi excluído e a recuperação quando uma retirada falha antes de terminar.
- O teste `tests/sharing-ui.cjs` usa servidor simulado e perfil temporário. A validação com duas contas no servidor real é uma etapa separada.
