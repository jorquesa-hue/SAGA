# Documentos legais — status

> **MINUTA (DRAFT) — NÃO REVISADA POR ADVOGADO.** Os três documentos
> nesta pasta foram redigidos para preencher a estrutura exigida pela
> LGPD e pela spec §6 deste projeto (nenhum dado real de aluno pode ser
> carregado antes de existirem documentos legais reais). Eles cobrem os
> pontos que a LGPD exige que um documento desse tipo cubra, mas **não
> substituem revisão por um advogado brasileiro especializado em LGPD**
> antes de qualquer uso com dados reais. Placeholders como
> `[RAZÃO SOCIAL DA ESCOLA]`, `[CNPJ]`, `[NOME DO DPO]`, `[E-MAIL DO DPO]`
> precisam ser preenchidos por escola (lembrando que, desde a Migration
> 0014, cada `unidade` pode ter razão social/CNPJ próprios).

## Arquivos

- `termo-de-uso.md` — condições de uso da plataforma pelos responsáveis,
  alunos maiores de idade e colaboradores da escola.
- `politica-de-privacidade.md` — o documento LGPD principal: dados
  coletados, finalidades, base legal, retenção, direitos do titular,
  compartilhamento com terceiros (Asaas, provedor de eNF, Make.com),
  segurança, encarregado (DPO).
- `contrato-operador-de-dados.md` — contrato entre a escola (controladora,
  art. 5º VI da LGPD) e quem opera esta plataforma para ela (operador,
  art. 5º VII), formalizando o tratamento de dados de alunos/responsáveis
  por conta e ordem da escola.

## O que ainda falta para isto estar "pronto para produção"

1. Revisão jurídica de um advogado brasileiro (LGPD/direito educacional).
2. Preencher os placeholders por escola/unidade.
3. Publicar a versão final em uma URL estável e **atualizar
   `VERSAO_TERMO_ATUAL`** em
   `apps/web/src/app/(app)/portal/consentimento-form.tsx` para apontar
   para essa versão (o texto de `finalidade` no formulário de
   consentimento já foi alinhado ao texto da política de privacidade
   nesta pasta — ver commit que introduziu estes arquivos).
4. Só então carregar dados reais de alunos (spec §6 / CLAUDE.md-equivalente
   invariante 7: "No secret, production credential, or personal data is
   committed or placed in fixtures" — o mesmo princípio se aplica a dados
   reais em produção sem base jurídica pronta).
