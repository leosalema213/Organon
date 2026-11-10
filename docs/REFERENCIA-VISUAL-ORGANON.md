# Referência visual e de experiência do Organon

Referência conferida no código local em **09/11/2026**. Serve para implementar pedidos como “faça igual ao Organon” sem reler chats nem explorar o projeto inteiro. Descreve o estado local, que pode conter mudanças ainda não publicadas; não comprova publicação ou funcionamento remoto.

Raiz de referência nesta máquina: `C:\Users\leo_s\OneDrive\Documentos\ChatGPT\Pessoal\estudo-desktop`. Os caminhos abaixo são relativos a essa raiz; em outro projeto, consulte os arquivos por esse endereço completo. Não dependem do nome do chat.

## 1. Leitura rápida: o que significa “igual ao Organon”

- Interface compacta, tipografia Segoe UI, controles alinhados, bordas finas, cantos suaves e bastante organização horizontal.
- Tema claro de superfícies quase brancas e tema escuro de cinzas neutros. Acentos discretos; verde para conclusão/acerto, vermelho suave para erro e azul discreto para progresso quando esses estados forem apresentados.
- Logo vetorial legível, símbolo próprio e versão abaixo da marca. O Organon atual usa marca **monocromática** na interface e ícone grafite com símbolo creme no Windows. Não presumir que a marca atual tem degradê colorido.
- Uma única barra superior reúne ações e controles da janela. Aplicativos com várias áreas podem usar sidebar; utilitários simples preservam seu layout compacto.
- Botões e campos equivalentes: mínimo de **32 px**, fonte **12 px**, ícones de ação **14 px**. Financeiro é a referência de controles e filtros.
- Reutilizar a origem comum de modais, menus e edição de texto. Usar português e estados claros de carregamento, erro e conclusão.
- Preferências organizadas por assunto; atualização consultada ao abrir e manualmente, com escolha de quando baixar e instalar; preservar dados existentes.
- Identidade visual não exige migrar para Electron, copiar módulos do Organon ou aumentar o instalador. Respeitar peso, plataforma e finalidade do aplicativo de destino.

## 2. Índice para encontrar a fonte sem investigação ampla

| Assunto | Fonte local | O que consultar |
| --- | --- | --- |
| Regras vigentes | [AGENTS.md](../AGENTS.md) | Visual, dados, testes, preview e publicação |
| Estrutura e barra da janela | [src/App.jsx](../src/App.jsx) | `.app-shell`, `.sidebar`, `.brand`, `.topbar`, `.topbar-right` |
| Estilo base e claro | [src/styles.css](../src/styles.css) | `:root`, botões, cards, layout, estados |
| Tema escuro e player compacto | [src/theme.css](../src/theme.css) | `data-theme="dark"`, superfícies e exceções |
| Medidas e controles | [src/density.css](../src/density.css) | Tokens `--control-*`, densidades e breakpoints |
| Hierarquia tipográfica | [src/typography.css](../src/typography.css) | Títulos e métricas, inclusive plugins |
| Aplicação da marca | [src/branding.css](../src/branding.css) | Máscara SVG, cores, tamanhos e símbolo em tela estreita |
| Preferências e temas | [src/Preferences.jsx](../src/Preferences.jsx), [src/preferences.css](../src/preferences.css), [src/model.js](../src/model.js) | Abas, modos, presets e defaults |
| Paletas opcionais | [src/palettes.css](../src/palettes.css) | `data-palette` e tokens `--custom-*` |
| Modais | [src/Modal.jsx](../src/Modal.jsx), [src/modal.css](../src/modal.css) | Corpo, ações, foco, teclado e variante `panel` |
| Menus e painéis ancorados | [src/PopupMenu.jsx](../src/PopupMenu.jsx), [src/popup-menu.css](../src/popup-menu.css) | Portal, posicionamento e teclado |
| Campos ricos e editor | [src/RichText.jsx](../src/RichText.jsx), [src/RichTextField.jsx](../src/RichTextField.jsx), [src/rich-text.css](../src/rich-text.css) | `FormatToolbar`, `richExtensions`, seleção e mídia |
| Filtros e controles de referência | [src/plugins/financeiro/financeiro.css](../src/plugins/financeiro/financeiro.css) | `.financeiro-filters`, campos, tabelas e resumos |
| Atualizador | [src/Updates.jsx](../src/Updates.jsx), [electron/updates.cjs](../electron/updates.cjs), [electron/versions.cjs](../electron/versions.cjs) | Interface, download, integridade e comparação de versões |
| Ícone e instalador | [scripts/create-icon.cjs](../scripts/create-icon.cjs), [package.json](../package.json), [build/installer.nsh](../build/installer.nsh) | Derivação dos assets e assistente Windows |
| Identidade legada e canais | [IDENTIDADE-E-REPOSITORIOS.md](IDENTIDADE-E-REPOSITORIOS.md) | Compatibilidade de nomes, perfis e repositórios |
| Dados e backup | [DADOS-E-MIGRACOES.md](DADOS-E-MIGRACOES.md), [AUDITORIA-BACKUP.md](AUDITORIA-BACKUP.md) | Contrato dos dados e escopo do backup |

## 3. Logo, símbolo e ícones do aplicativo

| Arquivo | Uso correto |
| --- | --- |
| `assets/branding/organon-wordmark.svg` | Marca completa na interface; desenho vetorial em paths, não substituir por texto digitado em fonte parecida |
| `assets/branding/organon-symbol.svg` | Símbolo isolado, especialmente espaços estreitos; `viewBox="128 201 309 272"` |
| `assets/icon.svg` | Fonte editável do ícone Windows; composição quadrada com fundo próprio |
| `assets/icon.png` | Ícone raster gerado em 256 × 256; utilizado pela janela Electron |
| `assets/icon.ico` | Ícone Windows multirresolução, instalado e empacotado |
| `assets/branding/organon-selected-clean.png`, `organon-option-2.png` | Imagens de referência existentes; não são os arquivos carregados como wordmark pela interface |

O wordmark tem `viewBox="128 166 1908 414"`; preservar proporção, recorte e geometria dos SVGs. As marcas usam `currentColor`. Na interface, `App.jsx` aplica o wordmark como máscara CSS com fundo `currentColor`: isso permite cor consistente nos temas sem editar paths.

- Marca no claro: `#292824`; no escuro: `#f5edd9`; paleta personalizada: `var(--custom-text)`.
- Wordmark: caixa de **146 × 32 px**; até 1000 px de largura, **125 × 28 px**. `mask-size: contain`, sem repetição, alinhado à esquerda.
- Até 640 px, usar o símbolo em **28 × 28 px** e ocultar a versão. A regra específica está em `branding.css`.
- Versão em `small.app-version`, proveniente do pacote: fonte **9 px**, peso 400, entreletras `.2px`; margem superior final de **3 px** na marca Organon.
- Ícone Windows: tela **256 × 256**, tile em `(9,9)` de **238 × 238**, raio **51**, degradê grafite `#303030 → #101010`, contorno `#555` de 1 px e símbolo `#f5edd9`.
- `npm run icon` gera PNG e ICO com resoluções **16, 24, 32, 48, 64, 128 e 256** a partir de `assets/icon.svg`; requer o ambiente Electron/Playwright do projeto. Não editar apenas PNG/ICO, pois a próxima geração sobrescreve-os.

Em outro app, criar símbolo e wordmark próprios, com composição, peso e simplicidade coerentes. Levar a marca às superfícies aplicáveis: cabeçalho/sidebar, janela, barra de tarefas, atalhos e instalador. Fazer inventário dessas referências antes de trocar os assets. Preservar identificadores de instalação e dados; mudar a apresentação não autoriza renomeá-los.

## 4. Cores e temas

Os valores abaixo são bases existentes, não uma promessa de que todos os componentes usam exatamente a mesma cor. Tokens, regras de tema e sobrescritas locais compõem o resultado.

| Papel | Claro: base de `styles.css` | Escuro: base de `theme.css` |
| --- | --- | --- |
| Fundo | `#f6f7f9` | `#101010` |
| Texto raiz | `#282938` | `#ededed` |
| Texto secundário `--muted` | `#93949e` | `#999` |
| Linha `--line` | `#edeef2` | `#ffffff12` |
| Primária `--purple` | `#7460d8` | `#e3e3e3` |
| Primária forte `--purple-dark` | `#6652c6` | `#fff` |
| Violeta `--violet` | `#7962d6` | `#b9a3e8` |
| Azul `--blue` | `#5b90ce` | `#a3b5bb` |
| Laranja `--orange` | `#d79b5a` | `#c6ad89` |
| Verde `--green` | `#59a78d` | `#a2b9ab` |
| Rosa `--pink` | `#ca70a0` | `#c4a1b4` |

No claro, sidebar/topbar usam `#fdfdfe`, cards brancos e bordas discretas. No escuro, shell usa `#0b0b0bc9`, sidebar/topbar `#141414b8`, cards combinam `#191919ad` com realce translúcido, e modal usa `#161616`. São camadas, não fundos azuis. O botão primário escuro usa `#e5e5e5` e texto `#171717`. Erro suave de referência no Financeiro: `#c97474`.

Modos em Preferências: **Dispositivo, Claro, Escuro e Personalizado**. Persistir a escolha; “Dispositivo” acompanha o sistema. `App.jsx` aplica `data-theme` no elemento raiz e comunica a aparência à janela nativa. Os presets Rosa, Azul, Verde e Roxo são opt-in e definidos em `model.js`; `palettes.css` aplica `--custom-background`, `--custom-surface`, `--custom-accent`, `--custom-text` e `--custom-muted`. Não confundir o preset Azul escolhido pelo usuário com o dark neutro padrão.

Transparência/acrílico é uma melhoria quando suportada, com fallback opaco em `electron/main.cjs`. Em outro toolkit, reproduzir cores e hierarquia sem depender desse efeito. Cores de texto e conteúdo importado escolhidas pelo usuário continuam preservadas nos dois temas.

## 5. Tipografia, densidade e espaçamento

Família base: **`'Segoe UI', Arial, sans-serif`**, peso normal 400. Evitar fontes externas só para aproximar a interface. A marca é SVG, não usa essa fonte.

| Token | Compacta, padrão | Mínima (`minimal`) | Confortável (`comfortable`) |
| --- | --- | --- | --- |
| `--sidebar-width` | 200 px | 186 px | 223 px |
| `--header-height` | 48 px | 42 px | 59 px |
| `--page-x` / `--page-y` | 24 / 18 px | 18 / 12 px | 38 / 35 px |
| `--heading-size` | 21 px | 18 px | 28 px |
| `--section-gap` | 16 px | 10 px | 28 px |
| `--card-gap` | 12 px | 8 px | 17 px |
| `--card-header-y` / `--card-x` | 12 / 15 px | 9 / 12 px | 18 / 20 px |
| `--stats-height` / `--stats-value` | 84 / 25 px | 68 / 22 px | 136 / 30 px |
| `--brand-height` / `--player-height` | 78 / 64 px | 66 / 56 px | 104 / 78 px |

Controles equivalentes mantêm `--control-height:32px`, `--control-font:12px`, `--control-padding-x:11px`, `--control-line-height:16px` e `--control-icon-size:14px`. Inputs de uma linha, selects, `.primary`, `.secondary` e ações de modal compartilham esses tokens. Não aplicar altura fixa a textareas, leitores e editores.

Títulos de página: peso **650**, line-height **1.3**, entreletras **-.5 px**, tamanho do token. Seções: **17 px**, peso **650**, line-height **1.4**, entreletras **-.3 px**. `typography.css` prevalece sobre valores anteriores de seções. Cards de estudo usam título **13 px** e descrição **10 px** na densidade compacta. Esses textos auxiliares não substituem o padrão de 12 px para controles.

Raios de referência: botão de ícone **6 px**, card de estudo **9 px**, cards do Financeiro **12 px**, modal **12 px**, menu **9 px**. Usar bordas de 1 px e sombras suaves; não transformar todos os elementos em caixas de borda pesada.

## 6. Layout, cabeçalho e responsividade

- No caderno compartilhado aberto, uma indicação textual discreta no cabeçalho pode mostrar o editor recente por nome, sem barra extra ou cursores. Ela usa somente a última gravação confirmada pelo servidor, expira em cinco segundos e não ocupa espaço quando vazia. O conteúdo remoto entra na página já aberta, preservando seleção e histórico locais.

- Caderno compartilhado usa o cabeçalho comum de `src/Library.jsx`: voltar, capa e título na mesma linha, ícone discreto de compartilhamento e ações à direita (Editar por ícone, Nova página quando autorizado, Baixar cópia). `SharedNotebookReader` injeta indicação/ações nesse cabeçalho, sem barra adicional. Documento salva automaticamente; não acrescentar botões de salvar/descartar exclusivos do compartilhado. A modal comum `ShareResources` mantém destinatário e seletor compacto Pode ler/Pode editar na mesma linha, com quebra em largura estreita; permissões diferentes no lote aparecem como Varia por recurso.

O Organon é multipágina: sidebar à esquerda, conteúdo à direita, uma topbar e player inferior quando aplicável. A marca fica no topo da sidebar; a versão aparece abaixo; navegação mostra ícone, nome e eventualmente contador. Preferências ficam no rodapé lateral.

A topbar reúne contexto/breadcrumb à esquerda e ações à direita: tema, sincronização/notificações/som quando existentes, preferências, separador e minimizar/maximizar/fechar. Não criar outro header para repetir marca e controles da janela. Regiões `.drag` movem a janela; botões e campos devem ficar em `.no-drag` ou equivalente do toolkit.

- Electron atual: janela inicial **1260 × 850**, mínimo **840 × 620**, sem moldura nativa. Esses limites são específicos do Organon, não obrigação de outros aplicativos.
- `density.css` tem ajustes até **850 px** e **640 px**; `branding.css` também ajusta em **1000 px**. No layout mais estreito, sidebar vira faixa de **59 px** com símbolo e sem versão. A aplicação desktop comum não chega ao breakpoint de 640 px por seu mínimo, mas a interface web pode chegar.
- Cabeçalhos e filtros devem permitir quebra, com campos alinhados e `min-width:0` onde necessário. Usar `.financeiro-filters` como referência. Links e buscas precisam de largura útil.
- Cards preservam ações principais visíveis; editar/excluir e outras secundárias vão para menu de opções quando disputarem espaço. Verificar o menor tamanho suportado no destino.
- Utilitários de uma única função podem manter uma janela mínima com marca, tema e engrenagem no topo. Não importar a sidebar ou player só para “parecer Organon”.

## 7. Controles e componentes compartilhados

- Imagens no `NoteEditor` usam X vetorial centralizado no botão de remoção; o fundo escuro e o ícone branco se mantêm no hover, inclusive em dark e paletas. O alerta de sincronização do caderno tem margem inferior de 16 px e ações com quebra de linha. Falhas oferecem Sincronizar no mesmo caderno; conflitos reais oferecem Comparar versões em Modal compartilhado, com escolha por trecho e prévia de imagens, sem gerar cópias de rascunho.

- Edição de caderno: ícone Compartilhar nas ações do cabeçalho do Modal, ao lado de Fechar; rodapé com Excluir à esquerda e Cancelar/Salvar à direita. O alinhamento genérico de `.modal-heading-actions` pertence a `modal.css`; regras especializadas do editor continuam em `notebook.css`.

- **Ícones:** `lucide-react`, desenhos de contorno; usar a mesma linguagem em outros toolkits. Exemplos: `Sun`, `Moon`, `Monitor`, `Settings`, `Download`, `Upload`, `RefreshCw`, `Plus`, `X` e `Minus`. Ícones de ação em botões comuns têm 14 px via CSS; navegação usa 19 px e topbar geralmente 17 px. Botão exclusivamente de ícone precisa de nome acessível e dica textual.
- **Selects:** manter comportamento nativo e seta SVG consistente. `branding.css` reserva 32 px à direita e posiciona a seta a 12 px da borda. Evitar que texto e seta se sobreponham.
- **Modais:** usar `Modal`, com título, subtítulo opcional, fechamento, corpo e `.modal-actions`. Padrão: largura base 600 px; `small`, 380 px, sempre limitada pelo viewport. Cabeçalho 12 × 16 px, título 16 px, corpo 14 × 16 px, ações à direita com gap 8 px e separação superior de 14 px. Não duplicar padding no formulário. `panel` permite estrutura própria para painéis completos. Esc, contenção de foco e retorno ao elemento anterior já ficam no componente.
- **Menus:** usar `PopupMenu`, ancorado ao botão, sem backdrop de modal. Ele ajusta posição à janela, fecha por clique/foco fora e Esc, e permite setas/Home/End. Menu base: mínimo 205 px, padding 5 px, itens de 12 px; dark `#1b1b1b`, borda `#353535`. Não substituir por modal para ações secundárias.
- **Edição rica:** compartilhar `FormatToolbar`/`richExtensions`; campos compactos usam `RichTextField`. Manter seleção, desfazer/refazer, mídia, cores e HTML importado.
- **Feedback:** indicar ação em curso no botão e desabilitar duplicação enquanto ocupado. Usar toast para confirmação breve, mensagem próxima da ação para erro recuperável e confirmação com consequência explícita para ação destrutiva. Preservar estado e permitir nova tentativa.

## 8. Preferências, backup e atualizações

`Preferences.jsx` organiza **Aparência, Geral, Conta, Plugins, Backup e Atualizações**; a aba Conta é condicional. Painel com título fixo, abas, área central rolável e rodapé “Preferências salvas automaticamente” + “Concluir”. Ações equivalentes continuam compactas. O Organon usa painel de até **740 × 640 px**, limitado pelo viewport, com layout específico em `preferences.css`.

Em outro app, mostrar apenas as categorias que existirem. Preferências de tema persistem e devem voltar ao reabrir. Não adicionar conta, sincronização, plugins ou tela de backup sem função real.

**Backup:** exportar/importar com ações explícitas; antes de restaurar, explicar o que substituirá os dados atuais e permitir cancelar. O backup pessoal do Organon inclui planos, histórico, anotações, imagens e outros dados descritos no contrato; não equivale a exportar toda a conta online. Financeiro e MEI têm exportação própria. Consultar os documentos de dados para o formato exato, sem copiar indiscriminadamente para outro app.

**Atualização:** `useAppUpdates` consulta ao abrir (após 2 s quando habilitado) e permite verificação manual. Estados: `idle`, `checking`, `current`, `available`, `downloading`, `ready`, `scheduled`, `installing`, `error`. Mostrar versão atual e destino, progresso de download e erro legível com nova tentativa.

Fluxo: aviso de versão → **Depois** ou **Baixar atualização** → **Atualizar e reiniciar** ou **Instalar na próxima abertura**; permitir cancelar o agendamento. Download em segundo plano não bloqueia o uso. Salvar os dados antes de instalar. O backend deve verificar procedência e integridade; um popup parecido não constitui um atualizador completo. Previews não entram no canal de produção, e a final deve atualizar um preview com a mesma base.

Após o download, a modal usa largura de 480 px e mantém **Instalar na próxima abertura** e **Atualizar e reiniciar** na mesma linha, sem botão Depois; o X permite fechar. No estado agendado, a ação secundária passa a **Cancelar agendamento**, mantendo os dois botões na mesma linha. Os demais estados preservam a largura compacta e suas ações.

## 9. Instalação, distribuição e preservação dos dados

O Organon usa Electron + electron-builder + NSIS no Windows. “Electron” é o runtime; o assistente de instalação é NSIS. O padrão de experiência pode ser reproduzido em um app nativo ou Tauri sem transportar esse runtime.

- Instalação interativa em português (`pt_BR`), boas-vindas, escolha de pasta, confirmação do destino e conclusão com opção de abrir.
- Pacote atual: `Organon-Instalar.exe`, `oneClick:false`, escolha de diretório habilitada, `perMachine:false`, atalho desktop e `deleteAppDataOnUninstall:false`. A abertura final e o modo de atualização têm customizações em `installer.nsh`; consultar o hook antes de reproduzir o comportamento.
- Atualizações evitam repetir o assistente; não apagar dados pessoais nem abrir perfil vazio para demonstrar mudança visual.
- Compatibilidade: o `appId` Organon continua `br.com.compasso.estudos`; nomes legados de perfil/arquivo e canais existem por migração. São específicos desse produto. Outro app precisa de seus próprios IDs e repositórios, preservando os que já distribuiu.
- Ícone, nome do produto e versão devem ser coerentes na janela, atalhos, instalador e preferências. Não copiar URLs de atualização, chaves ou IDs do Organon para outro aplicativo.
- Preview tem identificador próprio; final é gerada e publicada somente após validação/autorização do lote. Seguir `AGENTS.md` para versões, manifesto completo do ASAR, checksums, publicação e retenção das duas compilações locais.

## 10. Ordem de aplicação e conferência

1. Ler esta referência e as regras do projeto de destino. Identificar as superfícies realmente pedidas: marca, tema, controles, layout, preferências, instalador e/ou atualização.
2. Registrar restrições relevantes já dadas: peso do instalador, plataformas, layout a preservar, navegação necessária e dados existentes. Resolver dúvidas de comportamento antes da parte dependente.
3. Abrir apenas as fontes da tabela necessárias à alteração. Inspecionar a ordem de estilos em `src/main.jsx` e as regras locais do componente; não copiar `styles.css` inteiro para outro projeto.
4. Alterar componentes/tokens compartilhados primeiro e revisar seus usos. Em outro toolkit, mapear os mesmos papéis visuais para os controles existentes.
5. Conferir claro/escuro, escolha do dispositivo, persistência, marca sem distorção, ícones, foco, menus/modais, controles alinhados e menor janela suportada. Conferir todas as superfícies da marca se ela mudou.
6. Validar somente o fluxo afetado, conforme as regras de testes do usuário. Documento ou screenshot não comprova app empacotado, atualização real ou funcionamento em outra plataforma.
7. Gerar preview ao encerrar o lote, sem empacotar repetidamente entre pequenos ajustes. Não publicar por consequência de um pedido apenas visual.

Para referência por imagem, existem [interface.png](interface.png), [preferencias.png](preferencias.png), [aparencia-plano.png](aparencia-plano.png), [livros.png](livros.png) e [cadernos.png](cadernos.png). São apoio histórico e podem estar desatualizadas; em caso de divergência, conferir os componentes atuais e a regra aprovada pelo usuário. Não gerar novas capturas nem manipular o perfil pessoal só para ler esta referência.

Ao mudar a identidade ou os componentes compartilhados, atualizar a seção correspondente deste documento junto da alteração. Regras do projeto e instruções explícitas do usuário prevalecem; os arquivos-fonte resolvem detalhes que este guia não cobre.
