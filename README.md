# Mortus — Calendário pessoal com IA

**Status:** protótipo funcional em Next.js e TypeScript. O calendário permite navegar entre meses, selecionar dias e criar, editar e excluir eventos. Os eventos são salvos no `localStorage` do navegador.

O Mortus será um aplicativo pessoal de calendário com inteligência artificial integrada, para uso local e como portfólio Full Stack. A interface conceitual terá o calendário na área principal e o assistente em um painel de conversa lateral. O design definitivo será desenvolvido depois; o foco inicial é fazer as funções essenciais funcionarem.

## Estado atual
- Calendário mensal com navegação entre meses e seleção de dias.
- Eventos de demonstração e criação, edição e exclusão de eventos.
- Eventos com data e horário de início e término; o formulário rejeita términos que não sejam posteriores ao início, inclusive eventos que atravessam a meia-noite.
- Avisos identificam eventos sobrepostos considerando as datas e horários completos, sem bloquear o salvamento.
- A interface começa em `localStorage`; após uma migração explicitamente confirmada e conferida, passa a usar a API local e SQLite. A cópia do navegador não é apagada.
- A exclusão pede confirmação.

### Organização do código

- `app/page.tsx` concentra a interface, o estado visual e a resposta às interações. As operações de eventos e o acesso ao armazenamento são delegados a módulos reutilizáveis.
- `app/lib/events.ts` contém os tipos, validações, migração de registros antigos, detecção de conflitos e operações puras de criação, edição e exclusão. Esse módulo não depende de React nem do navegador.
- `app/lib/eventStorage.ts` concentra a leitura, migração persistida e gravação no `localStorage`, mantendo a chave `mortus.calendar.events.v1` e o tratamento de falhas.
- `app/lib/eventRepository.ts` implementa operações de persistência Prisma para criar, listar por intervalo de datas, consultar, editar e excluir eventos. Ele reutiliza as validações do domínio, converte IDs com segurança e não bloqueia eventos conflitantes.
- `app/lib/eventRepositoryServer.ts` conecta o repositório ao PrismaClient singleton protegido para uso apenas no servidor.
- `app/lib/eventApiClient.ts` valida as respostas REST consumidas pela interface e não converte falhas de rede em listas vazias.
- `app/actions/eventMigration.ts` executa a importação em lote por Server Action, verificando a origem local antes de chamar o repositório.

Essa separação mantém regras, persistência local, API e acesso ao banco independentes da interface. Há endpoints HTTP para eventos, mas ainda não existe login nem integração de IA.

Ao carregar dados antigos do `localStorage`, o aplicativo converte o campo `time` para `startTime` e atribui duração padrão de uma hora, incluindo quando o término cai no dia seguinte. Eventos já migrados preservam seus horários; quando não têm data de término, a migração usa a data original se o intervalo for válido nela e avança para o dia seguinte quando necessário. A chave `mortus.calendar.events.v1` é mantida. A migração salva a nova estrutura somente quando toda a lista pode ser convertida; dados inválidos permanecem no armazenamento sem serem sobrescritos.

### Proteção e backup dos dados

O carregamento diferencia armazenamento vazio, válido, inválido e indisponível. JSON inválido, estruturas incompatíveis, falhas de leitura ou falha ao persistir uma migração não são substituídos por dados de demonstração: as gravações normais ficam bloqueadas e a interface mostra um aviso. Se a gravação falhar, a interface mantém a lista anterior em memória.

Os controles ao fim da página exportam todos os eventos válidos em um arquivo JSON versionado com data de exportação. A importação aceita apenas backups do Mortus (versão 1), valida a lista inteira antes de agir, mostra a quantidade e pede confirmação para substituir todos os eventos. Arquivos inválidos são rejeitados sem gravação. O limite de importação é 5 MB. A substituição usa uma gravação única na chave existente `mortus.calendar.events.v1`; a lista em memória só é atualizada depois que essa gravação tem sucesso.

O backup é manual e fica sob responsabilidade do usuário. `localStorage` não é criptografado pela aplicação, pode ser removido pelo navegador e não substitui uma cópia guardada em outro local. Se os dados existentes estiverem corrompidos, exportação da lista bloqueada não é oferecida; preserve o perfil do navegador e recupere um backup válido.

O repositório Prisma, a API e a integração opcional com SQLite estão no servidor. A migração só ocorre por ação explícita no calendário; seus dados reais não são transferidos automaticamente. O arquivo SQLite local é ignorado pelo Git. O `localStorage` permanece como cópia de recuperação e nenhum dado real foi migrado nesta implementação.

## Próximas funcionalidades
- Assistente de IA integrado para consultar e propor alterações em eventos.
- Lembretes programados com antecedência configurável.
- Possível interação por voz em etapa futura.
- Integração futura com Google Calendar e notificações Gmail.

## Tecnologias

O projeto usa Next.js 16.4.3, React e TypeScript. Os estilos estão em CSS próprio; Prisma ORM 7.10.1 está configurado com SQLite por meio do adapter `better-sqlite3`. A API REST de eventos não tem autenticação: `npm run dev` e `npm run start` escutam apenas em `127.0.0.1:3000`, e as rotas e a Server Action de migração validam `Origin` e `Host` locais. O limite de corpo das Server Actions é 5 MB para acomodar lotes compatíveis com backups. Essas verificações reduzem requisições cross-origin do navegador e alguns cenários de DNS rebinding; não autenticam processos locais que podem falsificar cabeçalhos. Não exponha essas APIs publicamente nem configure proxy, túnel ou encaminhamento de portas para elas.

### API REST local

- `GET /api/events?from=AAAA-MM-DD&to=AAAA-MM-DD` lista eventos; os dois filtros são opcionais e inclusivos por data.
- `POST /api/events` cria um evento.
- `GET /api/events/[id]` consulta um evento.
- `PATCH /api/events/[id]` aplica campos do evento; envie somente campos a alterar. O ID não pode ser alterado.
- `DELETE /api/events/[id]` exclui um evento.

Escritas exigem `Origin` exatamente `http://localhost:3000` ou `http://127.0.0.1:3000` e `Host` local correspondente; requisições de escrita sem `Origin` são rejeitadas. Leituras também verificam `Host` e rejeitam `Origin` externo. Não há CORS habilitado. Essas medidas não substituem autenticação e a API deve permanecer restrita ao próprio computador.

### Banco local

Copie `.env.example` para `.env` se quiser sobrescrever o caminho padrão do banco. `.env` e os arquivos SQLite (`.db`, `.sqlite` e arquivos auxiliares) são ignorados pelo Git. O cliente Prisma gerado também é local e pode ser recriado.

Comandos para desenvolver o schema:

- `npm run db:generate` gera o Prisma Client em `app/generated/prisma`.
- `npm run db:migrate -- --name nome_da_migracao` cria e aplica uma migração de desenvolvimento sem resetar o banco.
- `npm run db:studio` abre o Prisma Studio para inspecionar o banco local.

O schema preserva os campos do evento, inclusive `date`, `endDate`, `startTime` e `endTime`. O ID no banco usa `BigInt` porque IDs antigos criados com `Date.now()` excedem o limite de `Int`. O repositório aloca IDs novos numa faixa inteira segura separada dos IDs históricos, verifica colisões no banco e converte valores de volta para `number` somente se forem seguros; isso mantém compatibilidade com a interface e backups versão 1. Os testes usam bancos SQLite temporários e não apontam para o banco local de desenvolvimento. O banco de desenvolvimento não recebeu dados do `localStorage`.

### Migração segura de eventos

`eventRepository.importBatch(events)` importa uma lista validada em uma transação SQLite. Ela preserva IDs e todos os campos do evento, inclusive `endDate`. Se o mesmo ID e conteúdo já existirem, o item é contado como existente. Um ID com conteúdo diferente interrompe o lote e reverte todas as inserções dessa transação. Entradas inválidas rejeitam o lote antes de iniciar a transação. A operação retorna `received`, `imported`, `alreadyExisting` e `conflicts`; repetir um lote já concluído não cria duplicatas.

A importação não é executada ao iniciar o app e não possui Route Handler REST próprio. O calendário mostra a contagem de dados reais detectados, exclui da transferência apenas demonstrações que correspondem exatamente aos registros de exemplo e prepara novamente a fonte diretamente do `localStorage` antes da operação. Se a fonte mudar durante a confirmação, o fluxo cancela e exige nova prévia e novo backup. O fluxo baixa um backup JSON v1 de todos os registros locais, exige que o usuário confirme que o guardou e pede confirmação explícita antes de chamar `importBatch` por uma Server Action. A action verifica o mesmo `Origin` e `Host` local permitido pelas APIs, valida os eventos no servidor e retorna somente o resumo. Após a importação, a interface relê o banco e compara os eventos por ID e conteúdo; só então grava uma chave de modo separada e passa a usar SQLite. O `localStorage` original nunca é apagado ou substituído.

Se houver evento inválido, conflito de ID ou erro na transação, o modo não muda e a cópia local permanece disponível. Corrija ou revise o item conflitante e repita após novo backup; a idempotência permite repetir com segurança lotes já importados. A cópia de `localStorage` é o retrato pré-migração e não é sincronizada com alterações posteriores no SQLite. Para recuperar o estado mais recente, exporte um backup v1 do modo SQLite. A importação de backup em modo local continua substituindo a lista local somente após confirmação; em modo SQLite, o backup é mesclado sem sobrescrever eventos existentes e conflitos são informados. A ação de migração não tem autenticação; `Origin` e `Host` reduzem CSRF e DNS rebinding, mas processos locais podem falsificar cabeçalhos. Portanto, o app continua limitado a `127.0.0.1` e não deve ser exposto publicamente.

### Ambiente isolado para teste manual da migração (Etapa 6.5C)

Para ensaiar a tela e a confirmação de migração com dados fictícios, use `npm.cmd run test-env:start`. Como a porta 3001 já está ocupada neste computador, o script usa a porta 3002. Ele aplica `prisma/migrations` somente em `.mortus-test/migration-test.db` e inicia uma instância separada em `http://127.0.0.1:3002`. Nessa origem, o navegador tem um `localStorage` separado do usado em `http://127.0.0.1:3000`; portanto, crie apenas eventos fictícios no ambiente de teste. A migração dos dados reais do navegador não foi executada.

O script grava `.mortus-test/server.json` no estado `starting` antes de migrar ou iniciar o servidor, e registra o PID assim que o processo é criado. Confira o destino com `Get-Content .mortus-test\server.json`: `databaseUrl` deve ser `file:./.mortus-test/migration-test.db`, `databasePath` deve terminar em `.mortus-test\migration-test.db` e `mainDatabasePath` deve terminar em `prisma\mortus.db`. `prisma7.config.ts` aplica a mesma URL ao Prisma CLI, e `app/lib/prisma.ts` injeta essa URL no adapter usado pelo repositório, APIs e Server Actions. Ambos interrompem a execução se `MORTUS_TEST_ENV=1` e qualquer variável do banco divergir da URL fixa de teste. Antes de migrar, o comando compara os caminhos, rejeita reparse points e verifica processos/porta; se o Windows não permitir essa verificação, não inicia nem migra.

Comandos no PowerShell, a partir da raiz do projeto:

- `npm.cmd run test-env:start` prepara o schema temporário e inicia o servidor de teste em loopback, porta 3002 (porta 3001 ocupada neste computador).
- `npm.cmd run test-env:stop` identifica o Next pelo executável, caminho do projeto, host e porta; encerra somente a árvore do processo verificada e registrada, sem `/F`, e remove o manifesto apenas após confirmar que os processos e a porta foram liberados. Um processo correspondente sem manifesto é tratado como ambíguo e não é encerrado. Se a consulta ou o encerramento falhar, preserva o manifesto e informa o bloqueio. Execute novamente em um PowerShell com permissão para consultar/parar processos.
- `npm.cmd run test-env:discard` recusa o descarte se houver manifesto, processo Next de teste, listener na porta ou consulta de estado indisponível. Após digitar `DISCARD MORTUS TEST DB`, verifica tudo novamente e rejeita junctions, links simbólicos e outros reparse points em todos os componentes dos caminhos. Também confirma a identidade física do SQLite e recusa arquivos com hard links ou identidade igual ao banco principal. Remove somente `migration-test.db` e os auxiliares `-journal`, `-wal` e `-shm` diretamente dentro de `.mortus-test/`; não remove a pasta nem os logs.

Iniciar, parar e descartar usam um mutex local para não correrem ao mesmo tempo. Se a inicialização falhar após criar o processo, o registro permanece em `failed` com o PID e a parada segura é tentada. Se não for possível provar que o servidor parou, o registro fica disponível para uma nova tentativa de `test-env:stop`; não execute o descarte nesse estado.

Os arquivos de `.mortus-test/` são ignorados pelo Git. Nunca copie dados pessoais para a instância da porta 3002. As APIs continuam sem autenticação; loopback e as verificações de origem não autenticam processos locais, então esse ambiente é somente para teste na própria máquina e não deve ser exposto à rede. O banco principal não é necessário para iniciar ou usar a instância de teste.

### Testes automatizados

Use Node.js 22.13 ou superior e execute `npm.cmd test` no Windows (ou `npm test` em outros terminais). A suíte usa o runner nativo `node:test` e remoção de tipos do Node. Os testes cobrem regras de eventos, migração, armazenamento simulado, backup v1, operações do repositório e Route Handlers contra SQLite temporário; verificam também persistência após desconectar e reabrir a conexão, validação de origem e respostas de erro. `migrationTestScripts.test.mjs` executa simulações PowerShell para caminhos incorretos, junctions, estado ativo/desconhecido do servidor e recuperação do manifesto sem abrir ou apagar bancos do Mortus. Eles não testam a interface, o clique de download nem a seleção de arquivos no navegador.

Para iniciar localmente, instale as dependências com `npm install`, gere o cliente com `npm run db:generate` e execute `npm run dev`. O servidor permanece restrito a `127.0.0.1`. Antes de permitir acesso por outros dispositivos, implemente autenticação e autorização nas rotas.

## Arquivos de contexto para o Codex
- [`AGENTS.md`](./AGENTS.md): regras de trabalho, contexto, arquitetura e segurança.
- [`TASKS.md`](./TASKS.md): estado atual, próxima tarefa e roadmap.

## Segurança e dados
- Não versionar chaves, senhas ou tokens; quando houver aplicação, manter segredos em variáveis de ambiente locais e fora do Git.
- Quando houver API e integração de IA, validar no servidor comandos e alterações de eventos; a IA não deve executar ações sem validação e autorização.
- Exigir confirmação explícita para exclusões e para ações futuras que afetem serviços externos.
- Tratar conteúdo de eventos e, quando a integração Gmail existir, mensagens como dados não confiáveis.

## Próximo passo
Consultar `TASKS.md`. A ordem do roadmap é: corrigir data e navegação; melhorar modelo dos eventos; separar regras de negócio; proteger dados armazenados; criar testes automatizados; preparar backend e banco de dados; integrar IA. A validação manual no navegador dos fluxos de eventos e backup continua pendente.

## Referências
- Next.js: https://nextjs.org/docs
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Gmail API: https://developers.google.com/workspace/gmail/api
- Google Calendar API: https://developers.google.com/workspace/calendar/api
- Prisma: https://www.prisma.io/docs
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
