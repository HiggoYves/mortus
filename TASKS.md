# TASKS.md — Estado e próximos passos

## Estado atual verificado (2026-10-28)
- [x] Ideia e objetivo do projeto definidos.
- [x] Direção do produto alinhada: calendário próprio com assistente de IA e lembretes; voz, Google Calendar e Gmail ficam para etapas futuras.
- [x] Stack e arquitetura inicial propostas.
- [x] Inspeção inicial do repositório realizada: existem `AGENTS.md`, `README.md` e `TASKS.md`, além de `.npm-cache` criado durante o diagnóstico do npm.
- [x] Inspeção documental atualizada: não há código-fonte, manifesto de dependências ou configuração executável no diretório.
- [ ] Repositório Git inicializado (o diretório atual não é um repositório Git).
- [ ] Aplicação Next.js/TypeScript inicializada (a tentativa do gerador não criou arquivos).
- [ ] Calendário e eventos implementados.
- [ ] Persistência configurada.
- [ ] Assistente de IA integrado aos eventos.
- [ ] Lembretes configuráveis implementados.
- [ ] Aplicação executada e verificada localmente.

> Diagnóstico desta sessão: o executor de comandos disponível está em sandbox `workspace-write` com rede restrita; ele não é o PowerShell local irrestrito do usuário. Neste executor, `npm ping` falha com `EACCES` e `curl` não conecta ao registro npm nem a `example.com`. O usuário relata que, no terminal local do Windows, `curl.exe -I https://registry.npmjs.org` retorna HTTP 200. A configuração npm neste workspace é padrão e sem proxy, portanto a diferença é de ambiente, não de configuração do projeto. A skill de controle de computador proíbe automatizar o Terminal/PowerShell pela interface. Não foi executado o gerador, não houve mudança nos arquivos da aplicação e não foi possível iniciar ou testar o app. Para continuar com a implementação pelo agente, é necessário executar esta sessão em um executor com acesso à rede local ou habilitar rede para o sandbox.

## Próximas etapas
1. Preparar a base da aplicação após conferir o ambiente e escolher uma stack compatível; a stack proposta anteriormente ainda não está confirmada no repositório.
2. Criar um calendário funcional e operações de consultar, criar, editar e excluir eventos.
3. Definir e configurar persistência para os eventos.
4. Integrar o assistente de IA aos eventos com validação no servidor e confirmação antes de excluir.
5. Implementar lembretes com antecedência configurável.
6. Executar e verificar a aplicação e o acesso responsivo/local pela rede.
7. Planejar sincronização Google Calendar e notificações Gmail; avaliar voz e design definitivo em etapas futuras.

O diagnóstico de rede e a tentativa anterior do gerador descritos abaixo permanecem como histórico. O bloqueio reportado naquela sessão deve ser reavaliado antes de retomar a inicialização; não alterar configuração npm sem evidência de problema.

## Roadmap
- [ ] Etapa 1 — Base da aplicação e interface funcional do calendário.
- [ ] Etapa 2 — Persistência e operações de eventos (consultar, criar, editar e excluir).
- [ ] Etapa 3 — Assistente de IA integrado aos eventos com validação no servidor.
- [ ] Etapa 4 — Lembretes programados com antecedência configurável.
- [ ] Etapa 5 — Responsividade e acesso local pela rede.
- [ ] Etapa 6 — Integração futura com Google Calendar para sincronização.
- [ ] Etapa 7 — Notificações futuras via Gmail; avaliar interação por voz.
- [ ] Etapa 8 — Refinar design, testar, documentar e publicar quando apropriado.

## Decisões técnicas atuais
- Plataforma inicial: web responsiva para computador e celular.
- Objetivo: calendário pessoal com IA, para uso local e portfólio Full Stack.
- Arquitetura: monólito modular.
- Stack proposta, ainda não verificada: Next.js, TypeScript, Tailwind, PostgreSQL e Prisma.
- Calendário do Mortus será a agenda própria inicial; sincronização com Google Calendar é futura.
- Integrações futuras: Google Calendar para sincronização, Gmail para notificações e API de IA para comandos sobre eventos.
- WhatsApp: fora do MVP inicial.

- 2026-10-28: primeira inspeção confirmou que o projeto ainda está somente no estágio de planejamento. O diretório não contém código, dependências ou repositório Git.
- 2026-10-28: usuário confirmou HTTP 200 no PowerShell local, mas o executor desta sessão segue em sandbox com rede restrita. A configuração npm está correta; o bloqueio ocorre no executor. A UI automation de terminais é vedada pela skill computer-use. Retomar quando houver executor local/rede disponível.
- 2026-10-28: visão do Mortus e prioridades documentais atualizadas conforme a direção de calendário próprio, IA e lembretes. A inspeção encontrou somente os três arquivos de documentação e `.npm-cache`; nenhuma funcionalidade foi implementada ou testada nesta atualização documental.
