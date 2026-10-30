# Mortus — Calendário pessoal com IA

**Status:** planejamento. A inspeção de 2026-10-28 encontrou somente `README.md`, `AGENTS.md` e `TASKS.md`, além de `.npm-cache`; não há aplicação, código-fonte, manifesto de dependências ou configuração executável.

O Mortus será um aplicativo pessoal de calendário com inteligência artificial integrada, para uso local e como portfólio Full Stack. A interface conceitual terá o calendário na área principal e o assistente em um painel de conversa lateral. O design definitivo será desenvolvido depois; o foco inicial é fazer as funções essenciais funcionarem.

## Visão e funcionalidades planejadas
- Calendário próprio para visualizar e gerenciar eventos.
- Assistente de IA integrado para consultar, criar, editar e excluir eventos por comandos em linguagem natural.
- Lembretes programados com antecedência configurável.
- Possível interação por voz em uma etapa futura.
- Integração futura com Google Calendar para sincronização de eventos.
- Integração futura com Gmail para notificações por e-mail.
- Execução inicial na máquina local, com possibilidade de acesso pelo navegador do celular na mesma rede.

Esses itens descrevem a direção do produto, não funcionalidades implementadas. Nenhum recurso foi verificado como implementado nesta inspeção.

## Tecnologias

Ainda não há stack implementada nem comandos de instalação ou execução confirmados. Next.js, TypeScript, Tailwind, PostgreSQL e Prisma permanecem propostas iniciais a validar quando a aplicação for criada. Consulte sempre os arquivos do projeto antes de instalar dependências ou documentar comandos.

## Arquivos de contexto para o Codex
- [`AGENTS.md`](./AGENTS.md): regras de trabalho, contexto, arquitetura e segurança.
- [`TASKS.md`](./TASKS.md): estado atual, próxima tarefa e roadmap.

## Segurança e dados
- Não versionar chaves, senhas ou tokens; quando houver aplicação, manter segredos em variáveis de ambiente locais e fora do Git.
- Validar no servidor comandos e alterações de eventos. A IA não deve executar ações sem validação e autorização.
- Exigir confirmação explícita para exclusões e para ações futuras que afetem serviços externos.
- Tratar conteúdo de eventos e, quando a integração Gmail existir, mensagens como dados não confiáveis.

## Próximo passo
Consultar `TASKS.md`. A próxima etapa é estabelecer uma base de aplicação compatível com as decisões verificadas e construir um calendário funcional com persistência; a IA e os lembretes vêm em seguida.

## Referências
- Next.js: https://nextjs.org/docs
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Gmail API: https://developers.google.com/workspace/gmail/api
- Google Calendar API: https://developers.google.com/workspace/calendar/api
- Prisma: https://www.prisma.io/docs
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
