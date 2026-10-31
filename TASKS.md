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
- [x] Aplicação e persistência local verificadas manualmente pelo usuário.

> Diagnóstico histórico de 2026-10-28: o executor daquela sessão tinha rede restrita; `npm ping` falhou com `EACCES` e `curl` não conectou. O PowerShell local do usuário tinha acesso à rede. Essa limitação não descreve o estado atual do código.

## Próximas etapas
1. Planejar backend e banco de dados quando houver necessidade concreta.
2. Integrar IA aos eventos com validação no servidor e confirmação antes de excluir.
3. Manter verificações manuais de navegador para interface e download/importação de arquivos.
4. Planejar lembretes, acesso móvel, integração Google Calendar, Gmail e voz em etapas futuras.

O diagnóstico de rede e a tentativa anterior do gerador são registros históricos; a aplicação já foi criada. A configuração npm não foi alterada.

## Roadmap
- [x] Etapa 1 — Corrigir data e navegação.
- [x] Etapa 2 — Melhorar modelo dos eventos.
- [x] Etapa 3 — Separar regras de negócio.
- [x] Etapa 4 — Proteger dados armazenados (validação de estado, bloqueio de gravação após falhas e backup JSON).
- [x] Etapa 5 — Criar testes automatizados (33 testes com `node:test`; módulos de domínio, armazenamento e backup).
- [ ] Etapa 6 — Preparar backend e banco de dados.
- [ ] Etapa 7 — Integrar IA.

## Decisões técnicas atuais
- Plataforma inicial: web responsiva para computador e celular.
- Objetivo: calendário pessoal com IA, para uso local e portfólio Full Stack.
- Arquitetura: monólito modular.
- Stack implementada: Next.js, React e TypeScript, com CSS próprio. PostgreSQL e Prisma ainda não estão configurados.
- Persistência atual: `localStorage` por navegador e origem, sem sincronização entre dispositivos ou backup no servidor.
- Calendário do Mortus será a agenda própria inicial; sincronização com Google Calendar é futura.
- Integrações futuras: Google Calendar para sincronização, Gmail para notificações e API de IA para comandos sobre eventos.
- WhatsApp: fora do MVP inicial.

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
