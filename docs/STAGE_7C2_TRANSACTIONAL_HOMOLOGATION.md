# Etapa 7C.2 — Homologação transacional PostgreSQL nativa

**Data:** 26/10/2026

**Ambiente:** PostgreSQL 17.11 nativo, local, temporário e descartável

**Resultado transacional:** 31/31 cenários aprovados

## 1. Parecer

**GO** para encerramento da homologação transacional local da Etapa 7C.

**NO-GO** para staging, integração com dados reais, aplicação das migrations em
bancos existentes, deploy ou produção.

O resultado comprova o comportamento das migrations 72 e 73 contra o baseline
sintético preparado para a Etapa 7C. Ele não substitui a futura homologação
contra o schema reconciliado de staging.

## 2. Ambiente executado

- distribuição portátil PostgreSQL 17.11 para Windows x86-64;
- arquivo obtido pelo endpoint da EDB indicado pela página oficial de downloads
  do PostgreSQL;
- tamanho validado: `340719294` bytes;
- SHA-256 calculado localmente:
  `6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3`;
- cluster exclusivo `ma-stage7c-<uuid>` sob `%TEMP%`;
- banco exclusivo `stage7c_<uuid>`;
- escuta restrita a `127.0.0.1:55437`;
- autenticação SCRAM;
- dados exclusivamente sintéticos;
- papéis testados sem `SUPERUSER` e sem `BYPASSRLS`.

O checksum acima registra o artefato efetivamente usado. Não foi localizado um
manifesto SHA-256 publicado pelo fornecedor para comparação independente.

## 3. Execução

A primeira tentativa foi recusada pelo PostgreSQL antes da inicialização do
servidor porque a sandbox do terminal Windows impediu a criação do token
restrito (`erro 87`). O `finally` do orquestrador removeu o cluster parcial; a
porta permaneceu livre e nenhum cenário foi executado nessa tentativa.

A segunda tentativa executou o mesmo orquestrador fora dessa restrição de
processo, preservando todos os controles de rede, identidade, banco e limpeza.
O servidor iniciou, o baseline foi carregado, as migrations 72 e 73 foram
aplicadas dentro da transação de teste e as 31 asserções foram executadas.

O runner concluiu com:

```text
RESULT passed=31 failed=0 total=31
```

## 4. Resultados por domínio

| Domínio | Cenários | Resultado |
| --- | ---: | --- |
| reconciliação do schema e policies offline | 1–4 | aprovado |
| isolamento offline por tenant, unidade, perfil e estado | 5–14 | aprovado |
| carteiras, pagamentos e recargas | 15–24 | aprovado |
| vínculos institucionais e cadastro do consumidor | 25–28 | aprovado |
| caixa e movimentos por tenant/unidade | 29–31 | aprovado |

A contenção financeira fail-closed de supervisor e gerente foi confirmada nos
cenários 17 a 22. O isolamento offline e os acessos institucionais também foram
confirmados, inclusive os testes negativos de cruzamento de tenant e unidade.

## 5. Rollback e descarte

- o runner executou baseline, migrations, fixtures e asserções dentro de
  `BEGIN/ROLLBACK`;
- o PostgreSQL encerrou normalmente via `pg_ctl`;
- processos PostgreSQL após a execução: `0`;
- listeners na porta `55437` após a execução: `0`;
- clusters `ma-stage7c-<uuid>` residuais: `0`;
- ZIP temporário removido: confirmado;
- distribuição portátil extraída removida: confirmado;
- espaço livre final no volume C: `3,34 GiB`.

O arquivo preservado como evidência foi sanitizado e não apresentou ocorrências
de senha, `PGPASSWORD` ou URL com credenciais.

## 6. Evidência

- `docs/evidence/stage7c/stage7c-native-20261026-153526.log` — saída sanitizada
  das 31 asserções e resultado agregado.

## 7. Alterações e limites

Nesta subetapa:

- nenhuma migration foi modificada;
- nenhuma migration foi aplicada a banco existente;
- nenhum banco remoto foi acessado;
- nenhum serviço permanente foi instalado;
- nenhum deploy ou commit foi realizado;
- nenhum dado real foi utilizado.

Validações finais do repositório:

| Verificação | Resultado |
| --- | --- |
| runner PostgreSQL transacional | 31/31 aprovado |
| controles do runner nativo | 20/20 aprovados |
| lint | aprovado |
| typecheck | aprovado |
| build Next.js | aprovado, 24/24 páginas estáticas geradas |

O build apresentou somente o aviso preexistente de que o plugin Next.js não foi
detectado na configuração do ESLint, sem interromper a validação.

## 8. Riscos residuais

1. O baseline sintético não representa todo o schema, extensões e comportamento
   PostgREST/Supabase de staging.
2. O drift documentado deve ser reconciliado antes de qualquer aplicação real.
3. A modelagem financeira canônica ainda exige revisão de integridade
   referencial, estornos, transferências e autorização temporal.
4. A Etapa 7D continua bloqueada até autorização expressa para staging,
   integração e desempenho.

## 9. Status consolidado

| Frente | Situação |
| --- | --- |
| Etapa 7C.1 — preparação nativa | concluída |
| Etapa 7C.2 — homologação transacional local | concluída — 31/31 |
| Etapa 7D — integração e desempenho | bloqueada |
| Staging | NO-GO |
| Dados reais | NO-GO |
| Produção | NO-GO |
