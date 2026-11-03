# Pacotes opcionais do Organon

Fontes de domínio: `src/plugins/financeiro/index.jsx` e `src/plugins/mei/index.jsx`.
Não importar essas páginas no shell. `scripts/plugins-build.mjs` gera pacotes
separados em `plugins/out/`, ignorado pelo Git. Nenhum pacote é gerado/publicado
automaticamente pelo build do aplicativo.

Um `.organon-plugin` é JSON UTF-8 com `{manifest,files}`. `files` contém apenas
`index.js` e, opcionalmente, `style.css`, codificados em base64. O manifesto
contém tamanho e SHA-256 dos bytes decodificados de cada arquivo. O catálogo
assinado contém tamanho e SHA-256 do pacote inteiro. Não há ZIP, extração,
caminhos arbitrários, executáveis nativos, dependências instaladas ou scripts
de pós-instalação.

O catálogo aceita somente Financeiro e MEI, assinados por chave Ed25519 própria,
com URLs de assets do repositório oficial. A chave privada pertence ao ambiente
de publicação; a chave pública deve ser fixada no main do aplicativo. Não
cometer chaves privadas ou confiar em uma chave fornecida pelo catálogo.

Consulte `docs/modulos/PLUGINS.md` para integração, comandos e publicação.
