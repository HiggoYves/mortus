# Mortus — Calendário pessoal com IA

**Status:** protótipo funcional em Next.js e TypeScript. O calendário permite navegar entre meses, selecionar dias e criar, editar e excluir eventos. Os eventos são salvos no `localStorage` do navegador.

O Mortus será um aplicativo pessoal de calendário com inteligência artificial integrada, para uso local e como portfólio Full Stack. A interface conceitual terá o calendário na área principal e o assistente em um painel de conversa lateral. O design definitivo será desenvolvido depois; o foco inicial é fazer as funções essenciais funcionarem.

## Estado atual
- Calendário mensal com navegação entre meses e seleção de dias.
- Eventos de demonstração e criação, edição e exclusão de eventos.
- Eventos com data e horário de início e término; o formulário rejeita términos que não sejam posteriores ao início, inclusive eventos que atravessam a meia-noite.
- Avisos identificam eventos sobrepostos considerando as datas e horários completos, sem bloquear o salvamento.
- Persistência local no navegador: as alterações ficam disponíveis após atualizar ou reabrir o mesmo navegador e origem.
- A exclusão pede confirmação.

### Organização do código

- `app/page.tsx` concentra a interface, o estado visual e a resposta às interações. As operações de eventos e o acesso ao armazenamento são delegados a módulos reutilizáveis.
- `app/lib/events.ts` contém os tipos, validações, migração de registros antigos, detecção de conflitos e operações puras de criação, edição e exclusão. Esse módulo não depende de React nem do navegador.
- `app/lib/eventStorage.ts` concentra a leitura, migração persistida e gravação no `localStorage`, mantendo a chave `mortus.calendar.events.v1` e o tratamento de falhas.

Essa separação prepara a lógica de eventos para reutilização futura no backend. Ainda não existe backend, banco de dados ou integração de IA.

Ao carregar dados antigos do `localStorage`, o aplicativo converte o campo `time` para `startTime` e atribui duração padrão de uma hora, incluindo quando o término cai no dia seguinte. Eventos já migrados preservam seus horários; quando não têm data de término, a migração usa a data original se o intervalo for válido nela e avança para o dia seguinte quando necessário. A chave `mortus.calendar.events.v1` é mantida. A migração salva a nova estrutura somente quando toda a lista pode ser convertida; dados inválidos permanecem no armazenamento sem serem sobrescritos.

### Proteção e backup dos dados

O carregamento diferencia armazenamento vazio, válido, inválido e indisponível. JSON inválido, estruturas incompatíveis, falhas de leitura ou falha ao persistir uma migração não são substituídos por dados de demonstração: as gravações normais ficam bloqueadas e a interface mostra um aviso. Se a gravação falhar, a interface mantém a lista anterior em memória.

Os controles ao fim da página exportam todos os eventos válidos em um arquivo JSON versionado com data de exportação. A importação aceita apenas backups do Mortus (versão 1), valida a lista inteira antes de agir, mostra a quantidade e pede confirmação para substituir todos os eventos. Arquivos inválidos são rejeitados sem gravação. O limite de importação é 5 MB. A substituição usa uma gravação única na chave existente `mortus.calendar.events.v1`; a lista em memória só é atualizada depois que essa gravação tem sucesso.

O backup é manual e fica sob responsabilidade do usuário. `localStorage` não é criptografado pela aplicação, pode ser removido pelo navegador e não substitui uma cópia guardada em outro local. Se os dados existentes estiverem corrompidos, exportação da lista bloqueada não é oferecida; preserve o perfil do navegador e recupere um backup válido.

Os eventos não são enviados a um servidor, não são compartilhados entre navegadores ou dispositivos e podem ser removidos ao limpar os dados do navegador. Não há autenticação nem banco de dados nesta etapa.

## Próximas funcionalidades
- Assistente de IA integrado para consultar e propor alterações em eventos.
- Lembretes programados com antecedência configurável.
- Possível interação por voz em etapa futura.
- Integração futura com Google Calendar e notificações Gmail.

## Tecnologias

O projeto usa Next.js, React e TypeScript. Os estilos estão em CSS próprio; não há Tailwind, banco de dados, ORM ou API de servidor configurados. Os comandos disponíveis em `package.json` são `npm run dev`, `npm run build` e `npm run start`.

### Testes automatizados

Use Node.js 22.13 ou superior e execute `npm.cmd test` no Windows (ou `npm test` em outros terminais). A suíte usa o runner nativo `node:test` e remoção de tipos do Node, sem instalar um framework. Os testes cobrem regras de eventos, migração, armazenamento simulado e formato de backup. Eles não testam a interface, o clique de download nem a seleção de arquivos no navegador.

Para iniciar localmente, instale as dependências com `npm install` e execute `npm run dev`. O servidor de desenvolvimento está configurado para escutar em `0.0.0.0`, permitindo acesso na rede local quando firewall e rede estiverem configurados. Na Etapa 5, `npm.cmd test`, `npx.cmd tsc --noEmit` e `npm.cmd run build` passaram.

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
