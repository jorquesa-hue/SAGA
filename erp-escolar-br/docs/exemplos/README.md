# Roteiro de teste — da migração ao portal da família

Este diretório traz um conjunto de dados fictícios para exercitar o sistema
do começo: uma escola que já opera, com histórico de pagamento, dívida,
irmãos e um aluno que atravessa dois anos letivos.

`migracao-colegio-passo-novo.csv` — 11 linhas, 10 alunos, 9 responsáveis.

Todos os CPFs e o CNPJ são **sintéticos**: têm dígito verificador correto
(o banco recusa inválido) e não pertencem a ninguém. Nenhum dado pessoal
real, conforme o invariante 7 do `CLAUDE.md`.

## Onde testar

    https://erp-escolar-br-git-claude-md-file-instructions-odzavn-jq81.vercel.app

Não há usuário pronto, e isso é de propósito: quem cria a escola é você, em
**Cadastre sua escola**, e o primeiro passo do roteiro já testa o
onboarding. Guarde a senha que escolher — não existe recuperação de senha
implementada.

Dados sugeridos para o cadastro:

| Campo          | Valor                   |
| -------------- | ----------------------- |
| Razão social   | Colégio Passo Novo Ltda |
| CNPJ           | `45678901000175`        |
| Município IBGE | `3550308` (São Paulo)   |

A escola que você criar é um inquilino separado. O isolamento é garantido
por RLS no banco, não por filtro de tela — você não verá dados da escola de
demonstração que já existe no projeto, nem ela verá os seus.

## Passo 1 — Estrutura (antes da importação)

**A importação nunca cria turma, curso, unidade ou ano letivo.** É
deliberado: etapa de ensino, turno, capacidade e o CNPJ que emite a nota são
decisões pedagógicas e fiscais que não cabem numa coluna de planilha, e
inventá-las em massa produziria uma estrutura plausível e errada.

Em **Escola → Unidades**, crie uma unidade (pode reusar o CNPJ acima).

Em **Escola → Turmas**, crie os dois anos letivos, os cursos e as cinco
turmas. Os nomes precisam bater com o CSV:

| Ano letivo | Curso          | Turma       |
| ---------- | -------------- | ----------- |
| 2025       | Fundamental I  | `4º Ano A`  |
| 2025       | Fundamental II | `7º Ano B`  |
| 2026       | Fundamental I  | `5º Ano A`  |
| 2026       | Fundamental II | `8º Ano B`  |
| 2026       | Ensino Médio   | `2º Ano EM` |

A comparação de nome ignora acento, caixa e espaço extra — `5o ano a`
também casa com `5º Ano A`.

## Passo 2 — Importação

**Matrículas → Importar**, envie o CSV. A tela roda primeiro um **ensaio**:
nada é gravado, e o relatório diz linha a linha o que seria criado, o que
seria reaproveitado e o que está errado. Só depois você confirma.

A gravação é tudo-ou-nada. Se uma linha falhar, nenhuma entra — planilha de
migração pela metade é pior que migração nenhuma.

O que conferir no resultado:

- **9 responsáveis para 10 alunos.** Marina Souza aparece em duas linhas
  (Ana e Pedro são irmãos) e tem de virar **uma** pessoa com dois filhos.
- **11 matrículas e 11 contratos para 10 alunos.** Lucas Andrade aparece em
  2025 e 2026 com o mesmo `matricula_codigo`: é o mesmo aluno, dois anos.
- **132 parcelas e 82 pagamentos** gerados a partir de `parcelas_pagas_ate`.
- Reenviar o mesmo arquivo não duplica nada: as linhas voltam como
  `já importada`.

## Passo 3 — O que cada caso do arquivo exercita

| Aluno                | O que testa                                                                       |
| -------------------- | --------------------------------------------------------------------------------- |
| Ana Beatriz Souza    | caso simples, quase em dia (só 09/2026 vencida)                                   |
| Pedro Henrique Souza | irmão da Ana, mesma responsável; desconto `irmao` 10%                             |
| Lucas Andrade        | **dívida de 2025 + parcelas de 2026** — o caso central                            |
| Júlia Castro         | nada pago: 12 abertas, 9 vencidas; bolsa em valor fixo                            |
| Miguel Tavares       | em dia; desconto `pontualidade` 5%                                                |
| Helena Nogueira      | duas vencidas                                                                     |
| Rafael Lima          | **responsável sem CPF** — o importador cai para nome + data de nascimento e avisa |
| Sofia Ribeiro        | matrícula `trancada` com quatro parcelas vencidas                                 |
| Théo Vasconcelos     | vínculo com acento (`avó`) e nome acentuado                                       |
| Beatriz Moraes       | 2025 integralmente quitado, serve de contraste                                    |

Confira os descontos na primeira parcela de 2026:

| Aluno                | Bruto    | Desconto                | Líquido  |
| -------------------- | -------- | ----------------------- | -------- |
| Pedro Henrique Souza | 1.200,00 | 120,00 (irmão 10%)      | 1.080,00 |
| Miguel Tavares       | 1.500,00 | 75,00 (pontualidade 5%) | 1.425,00 |
| Rafael Lima          | 1.500,00 | 120,00 (convênio 8%)    | 1.380,00 |
| Júlia Castro         | 1.250,00 | 200,00 (bolsa 2.400/12) | 1.050,00 |

## Passo 4 — A regra que bloqueia pagamento fora de ordem

Em **Financeiro**, tente registrar o pagamento da parcela mais recente do
**Lucas Andrade**. O banco recusa, com a razão:

> O aluno tem parcela vencida em outro contrato (competência 11/2025,
> vencida em 10/11/2025, R$ 916.67). Quite o débito anterior antes de
> registrar este pagamento.

Quite primeiro 11/2025 e 12/2025; só então 2026 é aceito. A recusa vem de um
gatilho no banco, não da tela: o app fala direto com o PostgREST, então
validação em formulário seria contornável por quem tem o token.

## Passo 5 — Portal da família

Para entrar como responsável é preciso um login, e **um responsável
importado não tem conta** — a planilha não traz e-mail. O caminho hoje é
**Equipe → convidar**, com papel `responsavel`, escolhendo o aluno e
marcando **financeiro**.

Isso cria uma pessoa _nova_, separada da que a importação criou. Está
descrito abaixo em "Limitações conhecidas" — é uma lacuna real, não o
desenho pretendido. Para o teste funciona: convide com um e-mail seu, e
**não repita o CPF** do responsável importado (o CPF é único por escola e a
segunda inserção falharia).

No portal (`/portal`), dá para testar:

- **Comunicados** com confirmação de leitura. Publique um para
  `Responsáveis` e outro para `Professores` na tela de Comunicados: o
  responsável enxerga só o primeiro. Publique um de turma e veja que chega
  apenas a quem tem filho matriculado nela.
- **Assinatura do contrato**: ler o texto, aceitar e assinar. Depois de
  assinar aparecem a data, o IP e o SHA-256 do texto, e dá para baixar uma
  cópia. Tente assinar de novo — é recusado.
- **Parcelas**, com indicação de qual pagar primeiro.
- **Seus dados**: corrigir o próprio e-mail.
- **Consentimento LGPD**.

## Passo 6 — Painel e relatórios

**Painel** e **Financeiro → Relatórios** passam a ter números de verdade:
inadimplência, faixas de atraso e previsão de recebíveis. Júlia Castro
(nada pago) e Sofia Ribeiro (quatro vencidas) são quem puxa os indicadores.

## O que NÃO dá para testar, e por quê

Nada disso é bug — são integrações que dependem de conta externa, e o
sistema falha alto em vez de fingir que funcionou:

| Funcionalidade      | Bloqueio                         | O que acontece hoje                                       |
| ------------------- | -------------------------------- | --------------------------------------------------------- |
| Boleto e PIX        | conta Asaas                      | `asaas_not_configured` (501)                              |
| Nota fiscal (NFS-e) | provedor de eNF                  | a nota nunca sai de `pendente`                            |
| Recibo por e-mail   | eNF **e** Resend                 | a fila nunca é preenchida, porque depende da nota emitida |
| Réguas de cobrança  | canais (WhatsApp/e-mail) no Make | cenários criados e inativos                               |

## Limitações conhecidas que este roteiro expõe

1. **Responsável importado não tem como receber acesso ao portal.** A
   planilha não tem coluna de e-mail, e `invite-pessoa` sempre cria pessoa
   nova em vez de vincular uma existente. O efeito é um cadastro duplicado
   da mesma pessoa. Uma escola migrando centenas de famílias sentiria isso.
2. **O convite vincula um aluno só.** Para a responsável de dois irmãos, o
   segundo vínculo não sai pelo convite.
3. **O texto do contrato não é um clausulado revisado por advogado** — é um
   resumo factual das condições. O mesmo vale para os documentos em
   `legal/`, que são minutas.
