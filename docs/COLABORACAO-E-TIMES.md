# Evolução para times e recursos compartilhados

Proposta discutida com o usuário em 03/11/2026, para a futura migração do kanban do Você Controla Aí. **Não implementa times, convites, kanban nem Realtime.** O lote atual melhora cadastro, sincronização pessoal e perfil.

## O que o modelo atual atende

`organon_sync_state` guarda uma cópia completa dos estudos por usuário, com revisão esperada e checksum. É adequado ao transporte da cópia pessoal do aplicativo local. A política de proprietário impede acesso entre contas. Os binários ficam no Storage privado. Estar conectado não transforma essa cópia em um documento colaborativo: a periodicidade e a escolha entre cópias continuam as descritas em `SUPABASE.md`.

`organon_profiles` guarda nome, apelido e hash da foto da própria conta, fora do snapshot pessoal. Essa tabela já foi criada no lote atual, com RLS exclusivo do proprietário. Não expõe diretório de usuários nem acesso a perfis/fotos de terceiros. Perfis compartilhados dependerão das permissões de equipe descritas abaixo.

## Modelo recomendado para a colaboração

Manter a sincronização pessoal existente e acrescentar registros próprios para o módulo compartilhado, no mesmo projeto Supabase. Um quadro compartilhado não deve ser guardado dentro dos snapshots de cada participante: duas cópias independentes não representam um estado comum.

| Entidade futura | Papel |
| --- | --- |
| Espaços/times (`workspaces`) | Limite de propriedade de recursos pessoais ou compartilhados. |
| Membros (`workspace_members`) | Vínculo aceito entre UUID de conta e espaço, com papel de proprietário, administrador, editor ou leitor. |
| Convites (`workspace_invites`) | Convites com aceitação explícita, validade, revogação e token seguro. |
| Quadros (`boards`) | Recurso ligado ao espaço, com identificador próprio e configuração de acesso. |
| Colunas (`board_columns`) | Colunas de um quadro, com ordenação persistida. |
| Cartões (`board_cards`) | Um registro por cartão; conteúdo, coluna, posição, autor e versão. |
| Acesso específico ao quadro (`board_members`), se necessário | Compartilhar/restringir um recurso sem liberar todos os recursos do time. |

O acesso deve ser decidido pelo banco, via RLS e vínculos ativos de membro/recurso. A interface apenas apresenta o que o servidor autoriza. Entrar num time não compartilha automaticamente estudos, cartas, livros ou finanças pessoais. Nome/apelido/e-mail não são identificadores de autorização; usar UUIDs estáveis. Como o cadastro atual não verifica e-mail, a posse do endereço informado não pode ser presumida para conceder acesso: convites precisam de mecanismo próprio seguro e aceitação.

Não reutilizar `user_metadata` editável para papéis ou autorização. A consulta de nome/foto de colegas deve ser limitada a vínculos aceitos e aos dados necessários, com acesso privado aos assets. Essa política não foi adicionada ao perfil atual.

## Escrita, atualização em tempo real e concorrência

1. A ação grava o registro afetado no banco: por exemplo, mover um cartão altera seu estado/posição, sem reenviar o quadro inteiro ou os estudos do usuário.
2. Após a transação, o servidor emite a mudança para um canal privado do quadro. A implementação deve avaliar Broadcast com autorização por quadro; é a abordagem recomendada pelo Supabase para escalabilidade e segurança.
3. Os clientes autorizados atualizam a tela. Realtime é a notificação da mudança; os registros persistidos continuam sendo a fonte do estado.
4. Ao reconectar, refazer a consulta autorizada para recuperar alterações ocorridas sem conexão e tratar remoções. Não assumir que todos os eventos foram recebidos nem exibir estado antigo como confirmado.

Atualizações de cartões distintos podem ser independentes. Alterações concorrentes do mesmo cartão precisam de uma política explícita: versão esperada e atualização atômica, com recarga/escolha em conflito. Movimentação e ordenação devem preservar invariantes em transação/RPC. Realtime sozinho não resolve conflitos nem oferece edição de texto equivalente ao Google Docs; CRDT/edição por caractere seriam outro escopo.

Para a primeira entrega colaborativa, priorizar edição online com estado de envio claro. Não prometer edição compartilhada offline até implementar uma fila durável de operações identificadas, tratamento de repetição, exclusões, revogação de acesso e conflitos de reconexão. Leitura em cache pode ser oferecida separadamente.

## Compatibilidade com os dados existentes

- Preservar contas, instalação, IDs legados, snapshot pessoal, histórico e arquivos existentes. Não é necessário apagar/recriar a tabela pessoal ou o projeto para adicionar times.
- Cache de recursos compartilhados deve ser separado do snapshot pessoal autoritativo. Uma restauração de backup pessoal não pode sobrescrever o quadro de todos, recriar acesso revogado nem ressuscitar cartões compartilhados removidos.
- Definir exportação/restauração explícita por quadro/time, sujeita à autorização, antes de oferecer backup colaborativo. A cópia pessoal atual não é um backup dos futuros recursos compartilhados.
- Importar o kanban antigo com mapeamento estável de IDs e validação antes do envio, quando o formato de origem estiver disponível. Movimentos de recursos privados para um time exigem escolha explícita de compartilhamento.
- Se o financeiro vier depois, usar o mesmo limite de espaço/membros e entidades próprias para seus registros. Evitar colocar gastos/projeções no snapshot compartilhado do quadro.

## Critérios da futura entrega

Validar com duas contas em clientes distintos: convite e aceitação, leitura/escrita por papel, propagação após commit, alteração simultânea no mesmo cartão, reconexão, remoção de membro, exclusões e isolamento de outro time. Validar banco, canais Realtime e Storage separadamente. Testes simulados não substituem essa prova remota.

Referências oficiais consultadas: [JSONB](https://supabase.com/docs/guides/database/json), [alterações em tempo real](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
