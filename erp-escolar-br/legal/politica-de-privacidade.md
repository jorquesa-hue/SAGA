# Política de Privacidade — ERP Escolar BR

**MINUTA — versão `2026-08-v1` (texto ainda em minuta — ver aviso acima). Não revisada por advogado. Ver
`legal/README.md`.**

Última atualização: [DATA]. Controladora: **[RAZÃO SOCIAL DA ESCOLA]**,
CNPJ **[CNPJ DA UNIDADE]** ("Escola", "nós"). Esta política se aplica a
todas as unidades da Escola cadastradas na plataforma ERP Escolar BR.

## 1. Quem somos e o que este documento cobre

A Escola utiliza a plataforma **ERP Escolar BR** para gerir matrículas,
contratos, cobrança, comunicação e dados pedagógicos. A Escola é a
**controladora** dos dados pessoais tratados (art. 5º, VI, Lei nº
13.709/2018 — LGPD). A empresa que desenvolve/opera a plataforma atua
como **operadora** (art. 5º, VII) nos termos do `contrato-operador-de-dados.md`.

## 2. Dados que coletamos

| Categoria          | Titular                  | Exemplos                                                                               | Finalidade                                               |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Identificação      | Aluno                    | Nome, data de nascimento, CPF (se houver)                                              | Matrícula, identificação escolar                         |
| Identificação      | Responsável/colaborador  | Nome, CPF, e-mail, telefone                                                            | Cadastro, comunicação, acesso ao sistema                 |
| Financeiros        | Responsável financeiro   | Dados de contrato, parcelas, forma de pagamento, histórico de pagamento                | Cobrança, emissão de nota fiscal, relatórios financeiros |
| Fiscais            | Escola (pessoa jurídica) | Razão social, CNPJ, inscrição municipal, código IBGE do município, por unidade         | Emissão de nota fiscal de serviço (NFS-e)                |
| Pedagógicos        | Aluno                    | Turma, matrícula, frequência (quando aplicável)                                        | Gestão escolar                                           |
| Comunicação        | Responsável              | Registros de envio de comunicados, réguas de cobrança                                  | Comunicação institucional e de cobrança                  |
| Acesso ao sistema  | Todos os usuários        | E-mail, papel (admin/secretaria/professor/responsável), IP no momento do consentimento | Autenticação, controle de acesso (RLS), auditoria        |
| Consentimento LGPD | Responsável/titular      | Finalidade aceita, versão do termo, data/hora, IP                                      | Comprovação de consentimento (art. 8º LGPD)              |

Não coletamos dados sensíveis (art. 5º, II) além do estritamente
necessário para a prestação do serviço educacional, e nunca os
utilizamos para fins diversos dos aqui descritos.

## 3. Base legal (art. 7º e art. 11 da LGPD)

- **Execução de contrato** (art. 7º, V): dados necessários à matrícula,
  cobrança e prestação do serviço educacional contratado.
- **Consentimento** (art. 7º, I / art. 8º): comunicação institucional
  não essencial e qualquer finalidade adicional apresentada no fluxo de
  "Consentimento LGPD" do portal do responsável — capturado com
  timestamp, IP e versão do termo (ver `consentimentos_lgpd` no banco de
  dados, tabela append-only).
- **Melhor interesse da criança e do adolescente** (art. 14, §1º): dados
  de alunos menores de idade são tratados no interesse pedagógico do
  próprio aluno, sempre com consentimento de ao menos um dos pais/
  responsável legal.
- **Cumprimento de obrigação legal/regulatória** (art. 7º, II): emissão
  de nota fiscal de serviço é obrigação fiscal municipal.

## 4. Com quem compartilhamos dados

| Terceiro                                                                 | Dados compartilhados                                          | Finalidade                                                          | Base                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| Provedor de pagamentos (Asaas, quando configurado)                       | Nome, CPF, valor, dados de cobrança do responsável financeiro | Emissão de boleto/cobrança                                          | Execução de contrato                      |
| Provedor de eNF (PlugNotas/eNotas/NFE.io/prefeitura, quando configurado) | Razão social/CNPJ da unidade, nome/CPF do tomador, valor      | Emissão de nota fiscal de serviço                                   | Obrigação legal                           |
| Make.com (réguas de cobrança)                                            | Nome do responsável, valor/vencimento da parcela              | Envio de lembrete de cobrança (WhatsApp/e-mail, quando configurado) | Execução de contrato / interesse legítimo |
| Supabase (infraestrutura, região `sa-east-1`, São Paulo)                 | Todos os dados acima, como subcontratada de infraestrutura    | Hospedagem do banco de dados e autenticação                         | Necessário à prestação do serviço         |

Nenhum dado é vendido ou compartilhado para fins de publicidade.
Nenhuma transferência internacional de dados ocorre além da eventual
operação de sub-processadores globais dos provedores acima, que devem
manter garantias equivalentes à LGPD (a confirmar por unidade/provedor
efetivamente contratado).

## 5. Isolamento entre escolas (multi-tenant)

A plataforma impõe isolamento técnico entre escolas/unidades por meio de
Row-Level Security (RLS) no banco de dados: nenhuma escola tem acesso
técnico aos dados de outra, verificado por suíte automatizada de testes
de isolamento (106 casos, ver `tests/tenant-isolation.test.mjs`).

## 6. Retenção e eliminação

Dados são mantidos enquanto durar o vínculo contratual do aluno/
responsável com a Escola e pelo prazo adicional exigido por obrigação
legal (fiscal: 5 anos; trabalhista, quando aplicável a colaboradores:
conforme legislação vigente). Eventos de domínio são **append-only**
(nunca sobrescritos) — correções são feitas por eventos compensatórios
explícitos, preservando o histórico para fins de auditoria, nunca
apagando o registro original. Solicitações de eliminação (art. 18, VI)
são atendidas dentro dos limites legais de retenção obrigatória.

## 7. Direitos do titular (art. 18 da LGPD)

O titular (ou seu responsável legal, no caso de aluno menor) pode, a
qualquer momento, solicitar à Escola: confirmação de tratamento, acesso,
correção, anonimização/eliminação, portabilidade, informação sobre
compartilhamento, revogação de consentimento. Solicitações devem ser
enviadas para **[E-MAIL DE CONTATO DA ESCOLA]** ou ao encarregado
(DPO) abaixo.

## 8. Encarregado de Dados (DPO)

Nome: **[NOME DO DPO]** — E-mail: **[E-MAIL DO DPO]**

## 9. Segurança

- Autenticação obrigatória; controle de acesso por papel (RLS).
- Tráfego criptografado (TLS) entre cliente, aplicação e banco de dados.
- Registros de auditoria append-only para eventos de domínio sensíveis.
- Nenhuma credencial de produção ou dado real de titular é versionado em
  código-fonte ou usado em ambiente de teste (dados de teste são
  sintéticos).

## 10. Alterações a esta política

Alterações materiais serão comunicadas aos responsáveis com nova versão
identificada em `VERSAO_TERMO_ATUAL`, exigindo novo consentimento quando
aplicável.
