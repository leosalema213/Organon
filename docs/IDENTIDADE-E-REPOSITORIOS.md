# Identidade Organon e migração dos repositórios

O produto, pacote npm, instalador principal, textos e documentação corrente usam **Organon**. Este lote prepara a mudança do endereço principal para `leosalema213/Organon`. A aplicação remota ocorre somente na publicação aprovada após o preview.

## Migração sem interromper clientes instalados

Não renomear nem apagar `leosalema213/app-estudos`: o atualizador distribuído valida literalmente esse endereço nos assets das Releases. Um redirecionamento do GitHub não resolve a divergência entre o endereço esperado e a URL canônica retornada pela API.

1. Validar o preview local. A nova versão consulta `Organon` primeiro; enquanto esse canal não tiver uma Release, um 404 permite consultar o canal legado. Erros de rede/servidor não causam uma troca silenciosa de canal.
2. Após autorização para publicar: promover a versão, gerar e conferir o instalador/manifesto/checksums, fazer commit e enviar o lote ao `origin` atual.
3. `npm run release -- --reuse-plugin-catalog` valida os artefatos e a árvore limpa. O publicador cria `Organon` na mesma conta e com a mesma visibilidade da origem, se ainda não existir. Confere as permissões, envia `main` e tags aos dois repositórios sem force push, adiciona o remote `legacy` e passa `origin` ao endereço principal. Um destino divergente interrompe o push sem sobrescrevê-lo.
4. Publica os mesmos bytes, checksums e catálogo primeiro no canal legado e depois no principal. Cada Release permanece em rascunho até completar seus assets. Uma falha parcial permite repetir a publicação: só reaproveita assets com tamanho, SHA-256 e estado de upload conferidos. Se os bytes ou o commit divergirem, interrompe em vez de substituir uma versão distribuída.
5. Conferir a atualização tanto com o atualizador antigo quanto com o novo. Quem está numa versão anterior recebe a versão de transição pelo canal legado; após instalá-la, passa a consultar `Organon`. O canal antigo continua recebendo espelhos para quem demorar a atualizar.

O histórico de commits/tags acompanha o novo endereço. Releases, issues e demais referências históricas do repositório original continuam preservadas na origem; nenhuma exclusão, renomeação ou arquivamento remoto é feita. O repositório antigo passa a informar sua função de canal legado e o link do principal. A criação e os uploads ainda precisam de validação real após a publicação autorizada; testes com API simulada não comprovam o GitHub real.

## Referências legadas mantidas por compatibilidade

| Referência | Por que permanece |
| --- | --- |
| `br.com.compasso.estudos` e variante de desenvolvimento | Identidade da instalação/Windows, preservada para atualizar a aplicação existente. |
| `%APPDATA%/compasso-estudos`, perfil alternativo `Compasso`, `compasso.json` | Localização dos dados existentes. Trocar o nome sem migração poderia abrir um perfil vazio. |
| `compasso-v1` | Chave persistida da versão web; preserva os dados anteriores. |
| `Compasso-Instalar.exe` | Cópia idêntica do instalador para atualizadores antigos, com checksum próprio. |
| `Uninstall Compasso.exe`, limpeza de `Compasso.exe` | Reconhecimento e limpeza restrita de instalações/artefatos antigos. |
| Registro de inicialização `Compasso` | Somente detecção/migração/remoção. O novo registro usa `Organon`; preserva a opção de desativação do Windows e só remove o antigo após confirmar o substituto. |
| `leosalema213/app-estudos` | Ponte de atualização e hospedagem de assets/catálogos assinados já distribuídos. |
| `COMPASSO_EXECUTABLE` | Alias aceito para comandos de testes anteriores; a variável preferida passa a ser `ORGANON_EXECUTABLE`. |
| Fixtures, testes e documentos históricos | Casos de compatibilidade, caminhos reais de recuperação e histórico de versões; não são apresentação atual da marca. |

Os links correntes do README, metadados do pacote e endereço principal de atualização usam `Organon`. Nomes temporários de testes, funções do instalador e MIME de arrastar blocos também passam a usar Organon. Não há renomeação da pasta pessoal do projeto ou movimentação de dados do usuário.

Os catálogos continuam assinados: URLs antigas não são editadas dentro de envelopes existentes. Novos catálogos espelhados continuam usando URLs do canal legado para que clientes anteriores possam validá-los; os pacotes são enviados aos dois repositórios. A nova versão aceita somente URLs exatas desses dois repositórios, além de conferir assinatura, sequência, tamanho e SHA-256 como antes.

Não remover o repositório antigo apenas porque o aplicativo já foi atualizado: os catálogos atuais ainda apontam para os pacotes assinados hospedados nele. Antes de uma eventual remoção, migrar/publicar esses assets e os catálogos, ajustar a política de espelho/URLs e verificar instalação, atualização, reparo e rollback dos plugins em perfis novos e existentes. Também é necessário encerrar a dependência dos atualizadores antigos. Este lote não autoriza nem executa essa remoção.

## Verificações preparadas

- `tests/repository-migration.test.js`: criação do destino, preservação do canal antigo, publicação dos mesmos bytes, recuperação de upload parcial, fallback, catálogo assinado e execução do atualizador real obtido da tag `v0.7.0` contra metadados simulados.
- `tests/updates.test.js`, `tests/plugins.test.js`, `tests/startup.test.js`, `tests/versions.test.js`: regressões de atualizações, plugins, migração do registro do Windows e versões.
- `tests/note-alarms.cjs`: controles de mesma altura, setas SVG, data e horário em duas colunas e fluxo de lembretes em perfil temporário.

A execução funcional fica no terminal do usuário. Até aqui, apenas a consulta real confirmou permissão administrativa na origem pública e ausência de um repositório `Organon` visível à conta; nenhum repositório foi criado, renomeado ou publicado neste lote.

Resultado recebido em 09/11/2026: os 48 testes focados, o build e o teste de interface de notas passaram no terminal do usuário. Os testes de publicação/migração e de inicialização Windows usaram APIs simuladas; a criação do novo repositório, os uploads reais e a migração do registro pessoal continuam sem execução. A publicação permanece condicionada à validação do preview e à autorização deste lote.
