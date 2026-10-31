# TASKS.md — Estado e próximos passos

## Estado atual verificado (2026-10-31)
- [x] Ideia e objetivo do projeto definidos.
- [x] Direção do produto alinhada: calendário próprio com assistente de IA e lembretes; voz, Google Calendar e Gmail ficam para etapas futuras.
- [x] Stack e arquitetura inicial propostas.
- [x] Inspeção inicial do repositório realizada em 2026-10-28; naquele momento havia apenas documentação e `.npm-cache`.
- [x] Projeto Next.js/TypeScript criado e publicado em `HiggoYves/mortus`, branch `main`.
- [x] Repositório Git inicializado com remote `origin` configurado.
- [x] Calendário mensal implementado com navegação e seleção de dias.
- [x] Modelo de eventos com início, término, validação de intervalo, migração dos registros antigos e detecção de conflitos (verificação automatizada da lógica concluída; interação visual ainda precisa de teste manual).
- [x] Etapa 5.1 — Eventos podem atravessar a meia-noite; término guarda data explícita, migração mantém a chave v1 e conflitos usam data/hora completas.
- [x] Regras de domínio e persistência local separadas da interface; validações automatizadas por execução direta dos módulos concluídas.
- [x] Armazenamento distingue dados vazios, válidos, inválidos e indisponíveis; erros de leitura e migração bloqueiam gravações normais.
- [x] Exportação e importação de backup JSON com versão, validação integral e confirmação explícita de substituição.
- [x] Operações de criar, consultar, editar e excluir eventos (validadas manualmente pelo usuário).
- [x] Persistência em `localStorage` e recuperação local (validadas manualmente pelo usuário).
- [ ] Assistente de IA integrado aos eventos.
- [ ] Lembretes configuráveis implementados.
- [x] Infraestrutura Prisma + SQLite, repositório CRUD e API REST local de eventos implementados. Autenticação, ligação da interface e migração dos dados do navegador continuam pendentes.
- [x] Etapa 6.3 — Repositório Prisma com CRUD, validação compartilhada, IDs numéricos compatíveis e testes de integração em SQLite temporário.
- [x] Etapa 6.4 — Route Handlers REST para listar, criar, consultar, editar e excluir; validação de campos e origem local com testes em SQLite temporário. API sem autenticação, restrita ao uso local e não adequada para exposição pública.
- [x] Etapa 6.5A — Importação em lote validada, transacional e idempotente no repositório, preservando IDs e detectando conflitos sem sobrescrever; sem endpoint ou execução automática.
- [x] Etapa 6.5B — Integração explícita da interface com SQLite após backup, confirmação e conferência; `localStorage` mantido como cópia e APIs usadas para CRUD no modo SQLite.
- [x] Etapa 6.5C — Ambiente manual separado em `.mortus-test/migration-test.db`, com verificação da URL no Prisma CLI e no Prisma Client, servidor exclusivo em `127.0.0.1:3002` (3001 ocupada neste computador) e comandos para iniciar, parar e descartar somente o banco de teste. Nenhuma migração de eventos reais foi executada.
- [x] Revisão de segurança dos scripts 6.5C — registro criado antes da inicialização, parada verificada por processo/porta, mutex entre comandos e bloqueio de caminhos com reparse points.
- [x] Aplicação e persistência local verificadas manualmente pelo usuário.

> Diagnóstico histórico de 2026-10-28: o executor daquela sessão tinha rede restrita; `npm ping` falhou com `EACCES` e `curl` não conectou. O PowerShell local do usuário tinha acesso à rede. Essa limitação não descreve o estado atual do código.

## Próximas etapas
1. Implementar autenticação e autorização antes de qualquer exposição do backend à rede.
2. Ligar a interface à API após definir a estratégia de autenticação e migração.
3. Implementar autenticação/autorização antes de qualquer acesso remoto e planejar a migração de volta do SQLite sem sobrescrever o `localStorage` automaticamente.
4. Integrar IA, lembretes, acesso móvel, Google Calendar, Gmail e voz em etapas futuras.

O diagnóstico de rede e a tentativa anterior do gerador são registros históricos; a aplicação já foi criada. A configuração npm não foi alterada.

## Roadmap
- [x] Etapa 1 — Corrigir data e navegação.
- [x] Etapa 2 — Melhorar modelo dos eventos.
- [x] Etapa 3 — Separar regras de negócio.
- [x] Etapa 4 — Proteger dados armazenados (validação de estado, bloqueio de gravação após falhas e backup JSON).
- [x] Etapa 5 — Criar testes automatizados (33 testes com `node:test`; módulos de domínio, armazenamento e backup).
- [ ] Etapa 6 — Backend e banco de dados (infraestrutura, repositório, API REST local, importação segura e ligação local da interface prontos; autenticação/autorização e eventual acesso remoto pendentes).
- [ ] Etapa 7 — Integrar IA.

## Decisões técnicas atuais
- Plataforma inicial: web responsiva para computador e celular.
- Objetivo: calendário pessoal com IA, para uso local e portfólio Full Stack.
- Arquitetura: monólito modular.
- Stack implementada: Next.js 16.4.3, React e TypeScript, com CSS próprio; Prisma ORM 7.10.1 com SQLite local e adapter `better-sqlite3`.
- Persistência: modo inicial no `localStorage`; modo SQLite ativado somente após migração confirmada e verificada. A cópia local é preservada, sem sincronização entre dispositivos ou backup no servidor.
- Calendário do Mortus será a agenda própria inicial; sincronização com Google Calendar é futura.
- Integrações futuras: Google Calendar para sincronização, Gmail para notificações e API de IA para comandos sobre eventos.
- WhatsApp: fora do MVP inicial.
- Banco local: arquivo SQLite ignorado pelo Git; repositório Prisma e integração de interface testados com banco temporário isolado; API sem autenticação e restrita a `127.0.0.1:3000`. O `localStorage` é mantido como retrato pré-migração não sincronizado.

- 2026-10-28: primeira inspeção confirmou que o projeto ainda está somente no estágio de planejamento. O diretório não contém código, dependências ou repositório Git.
- 2026-10-28: usuário confirmou HTTP 200 no PowerShell local, mas o executor desta sessão segue em sandbox com rede restrita. A configuração npm está correta; o bloqueio ocorre no executor. A UI automation de terminais é vedada pela skill computer-use. Retomar quando houver executor local/rede disponível.
- 2026-10-28: visão do Mortus e prioridades documentais atualizadas conforme a direção de calendário próprio, IA e lembretes. A inspeção encontrou somente os três arquivos de documentação e `.npm-cache`; nenhuma funcionalidade foi implementada ou testada nesta atualização documental.
- 2026-10-30: o protótipo já contém calendário mensal e operações de eventos. O salvamento local, a edição e a exclusão com confirmação foram implementados; ainda precisam de validação em execução local.
- 2026-10-30: o modelo passou a armazenar início e término; registros legados são migrados com duração padrão de uma hora; validação e detecção de sobreposição foram verificadas por execução automatizada da camada de eventos. TypeScript e build de produção passaram; os fluxos visuais ainda precisam de teste manual no navegador.
- 2026-10-31: operações de criar, editar e excluir foram extraídas para funções independentes de React em `app/lib/events.ts`; leitura, migração persistida e gravação foram encapsuladas em `app/lib/eventStorage.ts`, mantendo a chave `mortus.calendar.events.v1`. TypeScript, build de produção e checks diretos de regras/migração/armazenamento passaram. Criação, edição, exclusão, persistência após recarga, navegação e conflitos ainda precisam de teste manual no navegador.
- 2026-10-31: armazenamento passou a distinguir estado vazio, válido, inválido e indisponível; JSON/estrutura inválidos e erros de leitura ou migração bloqueiam gravações normais e exibem aviso. Backup JSON versionado foi implementado com validação completa, limite de 5 MB e confirmação de substituição. TypeScript e build passaram; checks simulados passaram para JSON inválido, estrutura incompatível, eventos/horários inválidos, falhas de leitura/gravação/migração, formato de backup, exportação, importação válida e migração antiga. Download, seleção de arquivo, confirmação e erros reais do navegador seguem pendentes de validação manual.
- 2026-10-31: Etapa 5 adicionou 33 testes permanentes com `node:test` para CRUD, validação, conflitos, migração, armazenamento simulado e backups. `npm.cmd test`, `npx.cmd tsc --noEmit`, build e `git diff --check` passaram. O runner não testa a interface nem downloads reais; Etapas 6 e 7 permanecem pendentes.
- Limitação identificada pelos testes: eventos legados iniciados às 23:30 são migrados com término às 23:59; iniciados às 23:59 não migram porque não existe término posterior no mesmo dia. A regra foi preservada nesta etapa; decidir separadamente se o modelo permitirá eventos atravessando a meia-noite.
- 2026-10-31: Etapa 5.1 adicionou `endDate` mantendo `date` como data inicial e preservou a chave `mortus.calendar.events.v1`. A migração agora atribui uma hora completa aos eventos antigos, inclusive na virada do dia, e completa a data de término em registros já migrados. A agenda exibe eventos que continuam no dia selecionado; conflitos comparam instantes completos. Os testes automatizados passaram com 36 casos e `npx.cmd tsc --noEmit` passou; interação visual ainda precisa de teste manual no navegador.
- 2026-10-31: Etapa 6.2 preparou Prisma ORM 7.10.1 e SQLite local, com schema inicial de eventos, ID `BigInt` para compatibilidade com IDs históricos baseados em `Date.now()`, cliente reutilizável, migração inicial e arquivos de banco ignorados pelo Git. O servidor foi restrito a `127.0.0.1`. APIs CRUD, login e importação do `localStorage` não fazem parte desta etapa.
- 2026-10-31: Etapa 6.3 adicionou `app/lib/eventRepository.ts` e o wrapper server-only ligado ao Prisma singleton. O repositório valida drafts, mantém IDs BigInt no banco e converte para números seguros no domínio, reserva uma faixa de IDs novos fora dos IDs históricos de timestamp e consulta intervalos com `date <= to` e `endDate >= from`. Testes de integração usam migração SQL em arquivos SQLite temporários, cobrem CRUD, entradas inválidas, colisões, eventos atravessando a meia-noite e persistência após reconexão; o banco local de desenvolvimento não é usado pelos testes.
- 2026-10-31: Etapa 6.4 adicionou Route Handlers REST para listar, criar, consultar, editar e excluir eventos. As rotas reutilizam o repositório, retornam JSON com IDs numéricos, validam dados e restringem requisições ao host local; escritas exigem `Origin` local correspondente a `Host`. Isso não autentica clientes locais nem torna a API apropriada para exposição pública. Testes exercitam as rotas e persistência em SQLite temporário; interface e `localStorage` permanecem inalterados.
- 2026-10-31: Etapa 6.5A adicionou `importBatch` ao repositório. A operação valida a lista inteira antes da transação, preserva IDs seguros e datas explícitas, reconhece duplicatas idênticas e aborta/retorna resumo em conflito com conteúdo diferente. A suíte testa rollback real em SQLite temporário, repetição idempotente, eventos noturnos e compatibilidade com a lista de um backup JSON v1. Nenhuma rota, tela ou execução automática de migração foi criada; dados reais não foram acessados.
- 2026-10-31: Etapa 6.5B integrou a interface sem executar migração automaticamente. O usuário revisa contagens, baixa e confirma backup v1 e confirma a importação; demos exatas são excluídas do lote. Uma Server Action local valida `Origin`/`Host` antes do `importBatch`; após releitura e conferência, a interface marca o modo SQLite sem alterar a lista do `localStorage`. CRUD usa a API no modo SQLite; falhas mantêm a última lista em tela e bloqueiam gravações se não for possível sincronizar. Nenhum dado real foi migrado.
- 2026-10-31: Etapa 6.5C adicionou ambiente manual de migração em `.mortus-test/migration-test.db`, independente do caminho principal `prisma/mortus.db`. O script aplica apenas as migrações locais no banco de teste, inicia Next em `127.0.0.1:3002` (3001 estava ocupada), registra e permite conferir o caminho real e oferece encerramento sem apagar dados e descarte com confirmação explícita. Prisma CLI e cliente do servidor falham se a URL divergir da URL fixa de teste. A origem/porta tem armazenamento de navegador separado; use somente dados fictícios. Nenhum evento real foi migrado.
