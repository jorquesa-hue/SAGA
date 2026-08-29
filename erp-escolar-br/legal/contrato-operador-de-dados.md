# Contrato de Operação de Dados (DPA) — ERP Escolar BR

**MINUTA — versão `2026-08-v1` (texto ainda em minuta — ver aviso acima). Não revisada por advogado. Ver
`legal/README.md`.**

Instrumento que formaliza, nos termos do art. 5º, VI e VII, e do art.
39, todos da Lei nº 13.709/2018 (LGPD), a relação entre:

- **CONTROLADORA**: **[RAZÃO SOCIAL DA ESCOLA / DA UNIDADE]**, CNPJ
  **[CNPJ]**, doravante "Escola"; e
- **OPERADORA**: **[RAZÃO SOCIAL DE QUEM OPERA/HOSPEDA A PLATAFORMA]**,
  CNPJ **[CNPJ]**, doravante "Operadora" — quem desenvolve/mantém a
  plataforma ERP Escolar BR em nome da Escola.

## 1. Objeto

A Operadora trata dados pessoais de alunos, responsáveis e colaboradores
da Escola **exclusivamente** conforme instruções documentadas da Escola
e para as finalidades descritas na Política de Privacidade
(`politica-de-privacidade.md`), nunca para finalidade própria.

## 2. Natureza e finalidade do tratamento

Hospedagem, processamento e disponibilização dos dados necessários à
operação do sistema de gestão escolar: matrícula, contratos, cobrança,
comunicação, portal do responsável e emissão de nota fiscal de serviço
(quando configurada), conforme descrito na Política de Privacidade.

## 3. Categorias de dados e titulares

Ver seção 2 (tabela) da Política de Privacidade — dados de alunos,
responsáveis e colaboradores da Escola.

## 4. Obrigações da Operadora

1. Tratar os dados **apenas** conforme instruções da Escola e para as
   finalidades deste contrato — nunca para finalidade própria ou de
   terceiros.
2. Garantir **isolamento técnico entre escolas/unidades** (multi-tenant)
   por controle de acesso obrigatório (Row-Level Security) em toda
   consulta, verificado por suíte automatizada de testes de isolamento.
3. Não sobrescrever histórico de eventos de domínio — correções são
   feitas por eventos compensatórios explícitos, preservando
   rastreabilidade.
4. Adotar medidas técnicas e administrativas de segurança (art. 46):
   criptografia em trânsito, autenticação obrigatória, controle de
   acesso por papel, registros de auditoria.
5. Notificar a Escola **sem demora injustificada** em caso de incidente
   de segurança que possa acarretar risco ou dano relevante aos
   titulares (art. 48), fornecendo informações suficientes para que a
   Escola cumpra suas próprias obrigações de notificação à ANPD/
   titulares.
6. Auxiliar a Escola a atender solicitações de titulares (art. 18):
   acesso, correção, eliminação, portabilidade.
7. Ao final da relação contratual com a Escola, eliminar ou devolver
   todos os dados pessoais tratados, ressalvada a retenção exigida por
   obrigação legal (ex.: documentos fiscais), e eliminar cópias
   existentes, salvo previsão legal em contrário.
8. Não subcontratar (sub-operar) o tratamento sem autorização da Escola,
   e exigir do subcontratado (ex.: provedor de infraestrutura, provedor
   de pagamento, provedor de eNF) o mesmo nível de proteção de dados
   aqui previsto.
9. Não comercializar, ceder ou usar os dados para publicidade ou
   qualquer finalidade fora do objeto deste contrato.

## 5. Obrigações da Escola (Controladora)

1. Ter base legal válida para toda coleta de dados que instrui a
   Operadora a tratar (consentimento do responsável, execução de
   contrato educacional, cumprimento de obrigação legal, conforme o
   caso).
2. Fornecer aos titulares a Política de Privacidade e o Termo de Uso
   antes ou no momento da coleta.
3. Ser o ponto de contato principal para solicitações de titulares e
   para a ANPD, com o apoio técnico da Operadora conforme item 4.6.

## 6. Subcontratados (sub-operadores) atuais

| Sub-operador | Função | Dados envolvidos |
|---|---|---|
| Supabase (infraestrutura, região `sa-east-1`) | Hospedagem de banco de dados, autenticação | Todos |
| Provedor de pagamentos (Asaas, quando configurado) | Cobrança | Dados financeiros do responsável |
| Provedor de eNF (quando configurado) | Emissão de nota fiscal | Dados fiscais da unidade + tomador |
| Make.com | Automação de réguas de cobrança/comunicação | Nome, valor/vencimento de parcela |

A Operadora compromete-se a comunicar a Escola sobre qualquer alteração
relevante nesta lista.

## 7. Vigência

Este contrato vigora enquanto durar a prestação de serviços da
Operadora à Escola, e por prazo adicional necessário ao cumprimento das
obrigações do item 4.7.

## 8. Auditoria

A Escola pode solicitar à Operadora, com aviso prévio razoável,
evidências razoáveis de conformidade com este contrato (ex.: relatório
de testes de isolamento entre tenants, política de segurança).

---

Assinaturas: **[ESCOLA]** _________________ **[OPERADORA]** _________________
