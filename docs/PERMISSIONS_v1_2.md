# PERMISSIONS.md
## Matriz de Perfis e Permissões
**Projeto:** Sistema de Controle de Refeições  
**Versão:** 1.0  
**Status:** Planejamento funcional  
**Stack prevista:** Next.js + Supabase + PWA

---

# 1. Objetivo

Este documento define os perfis de usuário, escopos de acesso e permissões funcionais do sistema.

Ele deve servir como referência para:

- implementação de autorização;
- definição de Row Level Security (RLS) no Supabase;
- controle de acesso por módulo;
- desenho de menus e interfaces;
- validação de ações sensíveis;
- auditoria de operações;
- testes de permissão.

Nenhuma implementação deve assumir que esconder um botão no frontend é suficiente.

Toda permissão relevante deve ser validada também no backend e, quando aplicável, protegida por RLS.

---

# 2. Perfis previstos

Perfis iniciais:

```text
admin_general
operations_director
finance
supervisor
unit_manager
operator
institution_user
student
```

Os nomes técnicos acima são provisórios e podem ser refinados antes da implementação.

---

# 3. Princípio de autorização

A autorização deve considerar três dimensões:

```text
PERFIL
+
ESCOPO
+
AÇÃO
```

Exemplo:

```text
Perfil: unit_manager
Escopo: unidade 12
Ação: visualizar alunos

Resultado:
permitido apenas para alunos associados à unidade 12
```

---

# 4. Escopos de acesso

## 4.1 Escopo global

Pode visualizar todas as unidades e instituições do tenant.

Perfis típicos:

- administrador geral;
- diretor operacional;
- financeiro, conforme módulo.

---

## 4.2 Escopo múltiplas unidades

Usuário pode visualizar somente as unidades explicitamente atribuídas.

Perfil típico:

- supervisor.

Tabela conceitual:

```text
user_unit_access
```

Campos sugeridos:

```text
user_id
unit_id
access_level
created_at
```

---

## 4.3 Escopo de unidade única

Usuário acessa apenas sua unidade.

Perfil típico:

- gerente da unidade;
- operador.

---

## 4.4 Escopo de instituição

Usuário acessa somente dados da instituição à qual está vinculado.

Perfil típico:

- institution_user.

---

## 4.5 Escopo pessoal

Usuário acessa apenas seus próprios dados.

Perfil:

- student.

---

# 5. Administrador geral

## Escopo

Global dentro do tenant.

## Permissões principais

Pode:

- visualizar todas as instituições;
- criar instituições;
- editar instituições;
- visualizar todas as unidades;
- criar unidades;
- editar unidades;
- visualizar todos os alunos;
- cadastrar alunos;
- editar alunos;
- alterar situação acadêmica;
- alterar categoria;
- importar alunos;
- visualizar categorias;
- criar categorias;
- editar categorias;
- alterar valores;
- visualizar carteiras;
- consultar saldos;
- visualizar transações;
- visualizar recargas;
- visualizar estornos;
- visualizar relatórios;
- exportar relatórios;
- visualizar auditoria;
- gerenciar usuários internos;
- atribuir perfis;
- atribuir unidades a usuários;
- alterar configurações globais;
- alterar configurações por unidade;
- visualizar dashboard consolidado.

## Ações sensíveis

Pode, se autorizado pela política final:

- aprovar estorno;
- aprovar devolução;
- realizar ajuste manual de saldo;
- alterar regras financeiras;
- alterar limites de consumo;
- gerenciar permissões.

Toda ação sensível deve gerar auditoria.

---

# 6. Diretor operacional

## Escopo

Global ou amplo dentro do tenant.

## Pode visualizar

- instituições;
- unidades;
- alunos;
- categorias;
- volumes de refeições;
- bloqueios;
- indicadores operacionais;
- dashboards;
- relatórios operacionais;
- desempenho por unidade;
- refeições por turno;
- refeições por categoria.

## Pode editar

- parâmetros operacionais autorizados;
- horários;
- configurações de fluxo;
- regras operacionais não financeiras, se autorizado.

## Não deve, por padrão

- alterar saldo;
- realizar ajuste financeiro;
- editar conciliação;
- gerenciar configurações financeiras críticas;
- alterar usuários administrativos globais.

---

# 7. Financeiro

## Escopo

Global dentro do tenant para dados financeiros.

## Pode visualizar

- recargas;
- pagamentos;
- carteiras;
- movimentações;
- valores pagos por alunos;
- subsídios;
- estornos;
- devoluções;
- conciliação;
- relatórios financeiros;
- fechamento mensal.

## Pode executar

Conforme política final:

- aprovar estornos;
- aprovar devoluções;
- realizar conciliação;
- registrar ajustes financeiros autorizados;
- exportar relatórios.

## Não deve

- alterar situação acadêmica;
- alterar curso;
- alterar dados institucionais do aluno;
- alterar regras operacionais de unidade;
- operar recepção de restaurante como função principal.

---

# 8. Supervisor

## Escopo

Somente unidades explicitamente atribuídas.

## Pode visualizar

- unidades atribuídas;
- alunos dessas unidades;
- volume de refeições;
- categorias;
- bloqueios;
- relatórios operacionais;
- indicadores;
- refeições por turno;
- desempenho por unidade.

## Pode editar

Se autorizado:

- determinadas configurações operacionais;
- dados de unidade;
- horários operacionais;
- parâmetros não financeiros.

## Não deve

- acessar unidades não atribuídas;
- alterar saldo;
- gerenciar usuários globais;
- alterar regras financeiras globais;
- visualizar dados de outros tenants.

---

# 9. Gerente de unidade

## Escopo

Somente sua unidade.

## Pode visualizar

- alunos da unidade;
- situação dos alunos;
- categorias;
- consumo diário;
- consumo por turno;
- bloqueios;
- recargas relacionadas à unidade, se aplicável;
- dashboard da unidade;
- relatórios da unidade;
- operadores da unidade.

## Pode executar

Se autorizado:

- cadastro manual de aluno;
- edição de campos permitidos;
- correção operacional;
- solicitação de estorno;
- consulta de histórico.

## Não pode

- acessar outra unidade;
- alterar configurações globais;
- alterar tenant;
- alterar saldo diretamente, salvo permissão extraordinária;
- alterar regras financeiras globais;
- liberar acesso manualmente, salvo política futura específica.

---

# 10. Operador do restaurante

## Escopo

Somente a unidade de operação.

## Interface principal

Terminal de recepção.

## Pode

- escanear QR Code;
- digitar matrícula;
- visualizar resultado da validação;
- visualizar dados mínimos do aluno;
- visualizar saldo necessário para atendimento;
- visualizar motivo do bloqueio;
- iniciar nova leitura.

## Pode visualizar

Apenas o necessário para a operação:

- nome;
- foto, quando cadastrada;
- matrícula;
- categoria;
- refeição;
- status;
- valor debitado;
- saldo restante;
- motivo do bloqueio.

A validação do acesso é feita pela matrícula. A foto é opcional e serve apenas como apoio visual.

## Não pode

- alterar aluno;
- alterar categoria;
- alterar saldo;
- realizar estorno;
- criar recarga;
- liberar acesso bloqueado;
- alterar regras;
- visualizar relatórios financeiros;
- exportar dados;
- acessar outras unidades;
- gerenciar usuários.

---

# 11. Usuário da instituição

## Escopo

Somente sua instituição.

## Status

Perfil opcional.

## Pode visualizar inicialmente

- quantidade de refeições;
- volume por dia;
- volume por período;
- total de matrículas/categorias parciais atendidas;
- total de matrículas/categorias integrais/gratuitas atendidas;
- relatório resumido;
- relatório detalhado;
- lista de alunos vinculados à instituição, quando autorizada.

Os relatórios institucionais devem usar template com a marca da empresa operadora.

## Poderá futuramente visualizar

Se aprovado:

- categorias;
- situação dos alunos;
- relatórios de subsídio;
- histórico de consumo institucional.

## Não pode

Por padrão:

- alterar saldo;
- realizar recarga;
- editar valores;
- alterar regras financeiras;
- editar usuários internos da empresa;
- visualizar outras instituições;
- acessar auditoria interna;
- visualizar conciliação financeira da empresa.

---

# 12. Aluno

## Escopo

Apenas os próprios dados.

## Aluno parcial

Pode visualizar:

- próprio perfil;
- próprio saldo;
- próprio extrato;
- própria carteirinha;
- próprio histórico de refeições;
- próprias notificações;
- próprias recargas;
- próprios valores pagos.

Pode executar:

- iniciar recarga;
- consultar status de recarga;
- atualizar campos pessoais permitidos;
- visualizar QR Code;
- solicitar devolução, se política permitir.

## Aluno integral

Pode visualizar:

- próprio perfil;
- própria carteirinha;
- próprio histórico de refeições;
- próprias notificações.

Pode executar:

- atualizar campos pessoais permitidos;
- visualizar QR Code.

Não pode:

- visualizar saldo;
- acessar recarga;
- acessar extrato financeiro;
- consultar movimentações de carteira;
- iniciar pagamento.

Essas restrições devem existir no frontend e no backend.

## Não pode

- alterar matrícula;
- alterar instituição;
- alterar categoria;
- alterar situação acadêmica;
- alterar saldo;
- visualizar outros alunos;
- visualizar dados administrativos;
- acessar relatórios da unidade.

---

# 13. Matriz resumida de permissões

Legenda:

```text
V = visualizar
C = criar
E = editar
A = aprovar
X = sem acesso
L = limitado ao escopo
```

| Módulo | Admin | Diretor | Financeiro | Supervisor | Gerente | Operador | Instituição | Aluno |
|---|---|---|---|---|---|---|---|---|
| Instituições | V/C/E | V | V | L | L | X | própria | X |
| Unidades | V/C/E | V/E | V | L | própria | própria | L | X |
| Alunos | V/C/E | V | V | L | L/C/E | L | L | próprio |
| Categorias | V/C/E | V | V | L | V | V mínimo | V limitado | própria |
| Carteiras | V | V limitado | V | L | L | V mínimo | X | própria |
| Recargas | V | V | V/A | L | L | X | X | própria |
| Estornos | V/A | V | V/A | X | solicitar | X | X | solicitar |
| Consumo | V | V | V | L | L | operar | V limitado | próprio |
| Recepção | V | V | X | V | V | operar | X | X |
| Dashboard | V | V | V | L | L | X | L | X |
| Relatórios | V | V | V | L | L | X | L (resumido/detalhado institucional) | X |
| Auditoria | V | V limitada | V financeira | X | X | X | X | X |
| Usuários internos | V/C/E | V | X | X | L | X | X | X |
| Configurações globais | V/E | V limitada | X | X | X | X | X | X |
| Configurações da unidade | V/E | V/E | X | L | própria | X | X | X |

---

# 14. Regras de escopo por unidade

Toda consulta de dados operacionais deve considerar `unit_id`.

Exemplo:

```text
unit_manager
```

Só pode acessar registros cujo:

```text
unit_id IN user_unit_access
```

O mesmo princípio deve valer para:

- supervisor;
- gerente;
- operador.

---

# 15. Regras de escopo por tenant

Toda tabela de negócio relevante deve ser isolada por tenant.

Exemplo conceitual:

```text
tenant_id = current_user_tenant_id
```

Nenhum usuário deve conseguir:

- ler;
- editar;
- excluir;
- inserir;

dados pertencentes a outro tenant.

---

# 16. Regras de instituição

Usuários do tipo `institution_user` devem ser filtrados por:

```text
institution_id
```

O perfil não pode visualizar:

- outras instituições;
- dados internos da empresa sem relação com sua instituição;
- configurações globais;
- conciliações internas.

---

# 17. Regras do aluno

O aluno deve ser protegido por regra equivalente a:

```text
student.user_id = auth.uid()
```

O aluno só pode visualizar:

```text
seus dados
suas transações
suas recargas
seus consumos
suas notificações
sua carteirinha
```

---

# 18. Operações financeiras sensíveis

As seguintes operações nunca devem depender de acesso direto do frontend às tabelas:

```text
consume_meal
confirm_recharge
refund
reverse_transaction
manual_balance_adjustment
```

Devem usar:

- RPC;
- database function;
- server-side operation;
- Edge Function quando houver integração externa.

---

# 19. Ajuste manual de saldo

Se existir, deve ser extremamente restrito.

Perfis possíveis:

```text
admin_general
finance
```

Nunca:

```text
operator
student
institution_user
```

Deve exigir:

- motivo;
- usuário responsável;
- valor;
- tipo;
- timestamp;
- auditoria.

---

# 20. Estorno

Fluxo recomendado:

```text
Solicitação
↓
Análise
↓
Aprovação
↓
Estorno
↓
Auditoria
```

Quem pode solicitar:

- aluno, dependendo da política;
- gerente;
- financeiro;
- administrador.

Quem pode aprovar:

- financeiro;
- administrador.

Separar solicitação de aprovação ajuda a reduzir fraude e erro.

---

# 21. Liberação excepcional

Por padrão:

```text
operator = NÃO PODE
```

Se implementada futuramente:

Perfis possíveis:

```text
unit_manager
admin_general
operations_director
```

Deve exigir:

- motivo;
- confirmação;
- log;
- identificação do aluno;
- refeição;
- unidade;
- responsável.

---

# 22. Auditoria obrigatória

Gerar log para:

- alteração de perfil;
- alteração de escopo;
- alteração de unidade de usuário;
- criação de usuário interno;
- alteração de categoria;
- alteração de preço;
- mudança de situação do aluno;
- ajuste manual de saldo;
- estorno;
- devolução;
- liberação excepcional;
- importação de alunos;
- edição de regras.

---

# 23. Políticas RLS recomendadas

Exemplos conceituais.

## Tenant

```sql
tenant_id = current_tenant_id()
```

## Student

```sql
user_id = auth.uid()
```

## Unit manager

```sql
unit_id IN (
  SELECT unit_id
  FROM user_unit_access
  WHERE user_id = auth.uid()
)
```

## Institution user

```sql
institution_id = current_user_institution_id()
```

Esses exemplos são conceituais e não devem ser usados diretamente em produção sem validação.

---

# 24. Menu por perfil

## Administrador

```text
Dashboard
Instituições
Unidades
Alunos
Categorias
Financeiro
Relatórios
Usuários
Auditoria
Configurações
```

## Diretor operacional

```text
Dashboard
Unidades
Alunos
Operação
Relatórios
```

## Financeiro

```text
Dashboard Financeiro
Recargas
Movimentações
Subsídios
Estornos
Conciliação
Relatórios
```

## Supervisor

```text
Dashboard
Minhas Unidades
Alunos
Operação
Relatórios
```

## Gerente

```text
Dashboard da Unidade
Alunos
Operação
Relatórios
Equipe
```

## Operador

```text
Recepção
```

## Instituição

```text
Dashboard
Alunos
Relatórios
```

## Aluno parcial

```text
Início
Carteirinha
Saldo
Recarga
Extrato
Refeições
Perfil
```

## Aluno integral

```text
Início
Carteirinha
Refeições
Perfil
```

Não exibir:

```text
Saldo
Recarga
Extrato
```

---

# 25. Hierarquia não implica acesso automático

Não assumir:

```text
admin > diretor > supervisor > gerente > operador
```

como herança cega.

A permissão deve ser explícita.

Exemplo:

Financeiro pode ter mais acesso financeiro que diretor operacional.

Diretor operacional pode visualizar operação global sem poder editar saldo.

---

# 26. Campos sensíveis

Campos com acesso restrito:

```text
wallet_balance
financial_adjustments
subsidy_amount
payment_reference
gateway_transaction_id
audit_logs
role
tenant_id
institution_id
unit_access
```

---

# 27. Dados pessoais

Mesmo usuários administrativos devem receber apenas os dados necessários.

Exemplo:

Operador não precisa visualizar:

- telefone;
- e-mail;
- histórico financeiro completo.

Operador precisa visualizar:

- nome;
- foto;
- matrícula;
- status;
- categoria;
- valor da refeição;
- saldo necessário;
- resultado.

---

# 28. Princípio de menor privilégio

Todo perfil deve iniciar com o menor conjunto de permissões necessário.

Permissões extras devem ser adicionadas explicitamente.

Evitar lógica:

```text
permitir tudo e bloquear exceções
```

Preferir:

```text
bloquear por padrão
liberar explicitamente
```

---


# 29. Relatório institucional da universidade

O perfil `institution_user`, quando habilitado, deverá acessar apenas relatórios da própria instituição.

O relatório institucional terá dois modos:

## Resumido

Exibir:

- período;
- unidade;
- quantidade de matrículas/categorias parciais atendidas;
- quantidade de matrículas/categorias integrais/gratuitas atendidas;
- total geral.

## Detalhado

Exibir, conforme permissão:

- matrícula;
- nome do aluno;
- categoria;
- data;
- turno/refeição;
- unidade;
- valor pago;
- valor subsidiado.

## Template

O relatório deverá utilizar template com a identidade visual da empresa operadora, incluindo:

- logomarca;
- nome da empresa;
- instituição/unidade;
- período;
- data de emissão;
- paginação.

O usuário da instituição não poderá alterar dados operacionais ou financeiros a partir do relatório.

---

# 30. Testes de autorização


Criar testes para garantir:

## Aluno

- não acessa outro aluno;
- não altera categoria;
- não altera saldo;
- não vê auditoria.

## Operador

- não altera saldo;
- não acessa outra unidade;
- não libera bloqueio;
- não exporta relatório financeiro.

## Gerente

- não acessa outra unidade;
- não altera configuração global.

## Supervisor

- não acessa unidade não atribuída.

## Instituição

- não acessa outra instituição.

## Financeiro

- não altera dados acadêmicos sem permissão.

## Tenant

- nenhum perfil acessa dados de outro tenant.

---

# 31. Convite e provisionamento de usuários

Usuários internos devem ser criados por usuário autorizado.

Fluxo sugerido:

```text
admin cria convite
↓
define perfil
↓
define tenant
↓
define instituição/unidades
↓
usuário aceita convite
↓
conta é ativada
```

Evitar criação automática com privilégios elevados.

---

# 32. Desativação de usuário

Ao desativar usuário interno:

- bloquear login;
- preservar histórico;
- preservar auditoria;
- preservar operações anteriores;
- não apagar referências.

---

# 33. Mudança de perfil

Toda mudança de perfil deve:

- gerar auditoria;
- registrar perfil anterior;
- registrar novo perfil;
- registrar responsável;
- invalidar permissões antigas imediatamente.

---

# 34. Resumo de permissões críticas

Somente perfis específicos podem:

## Alterar preço

```text
admin_general
```

Possível futuro:

```text
finance
```

## Ajustar saldo

```text
admin_general
finance
```

## Aprovar estorno

```text
admin_general
finance
```

## Alterar situação acadêmica

```text
admin_general
unit_manager
```

Conforme política final.

## Gerenciar usuários

```text
admin_general
```

Possível acesso limitado do gerente para operadores da própria unidade.

---

# 35. Decisões ainda pendentes

Definir futuramente:

- gerente pode cadastrar operador?
- gerente pode alterar situação acadêmica?
- diretor operacional pode editar regras?
- instituição poderá alterar aluno?
- instituição poderá importar aluno?
- financeiro poderá editar categorias?
- supervisor poderá editar dados da unidade?
- aluno poderá solicitar estorno diretamente?
- gerente poderá aprovar exceção de entrada?
- acesso da instituição será padrão ou opcional por contrato?

---

# 36. Regras para implementação no Antigravity

Ao implementar permissões:

1. Não usar apenas verificação de frontend.
2. Não confiar apenas em `role` armazenado no cliente.
3. Sempre validar tenant.
4. Sempre validar escopo de unidade.
5. Sempre validar instituição quando aplicável.
6. Implementar RLS antes de liberar dados sensíveis.
7. Criar helpers centralizados de autorização.
8. Evitar duplicar lógica de permissão em componentes.
9. Criar testes por perfil.
10. Registrar ações sensíveis em auditoria.
11. Não usar service role no frontend.
12. Não desabilitar RLS como solução temporária.
13. Não conceder acesso global a supervisor ou gerente.
14. Não permitir que operador modifique dados financeiros.
15. Não permitir que aluno leia dados de outros usuários.

---

# 37. Arquivos relacionados

Este documento complementa:

```text
SISTEMA_REFEICOES_ANTIGRAVITY.md
```

Arquivos futuros:

```text
FLOWS.md
MVP.md
ARCHITECTURE.md
DATABASE.md
SECURITY.md
PAYMENTS.md
OFFLINE_STRATEGY.md
```

---

# 38. Fonte de verdade

Este documento é a referência principal de autorização do projeto.

Em caso de divergência entre:

- interface;
- código;
- implementação automática;
- interpretação do desenvolvedor;

a regra aqui registrada deve prevalecer até revisão formal.

---

**Fim do documento.**
