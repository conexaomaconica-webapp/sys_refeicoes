# FLOWS.md
## Fluxos Operacionais do Sistema de Controle de Refeições
**Versão:** 1.0  
**Status:** Planejamento funcional  
**Stack prevista:** Next.js + Supabase + PWA  
**Documentos relacionados:** `SISTEMA_REFEICOES_ANTIGRAVITY_v1_1.md`, `PERMISSIONS_v1_1.md`

---

# 1. Objetivo

Este documento descreve os principais fluxos operacionais do sistema.

Ele deve orientar:

- desenvolvimento das telas;
- criação de APIs e funções;
- regras transacionais;
- estados de interface;
- tratamento de erros;
- testes funcionais;
- testes de permissão;
- integração futura com pagamentos, QR Code e dispositivos físicos.

A prioridade do sistema é permitir operação rápida, segura e previsível durante horários de pico.

---

# 2. Princípio geral dos fluxos

Sempre que um fluxo envolver:

- dinheiro;
- saldo;
- consumo;
- liberação de refeição;
- mudança de categoria;
- alteração de situação;
- estorno;
- devolução;

a validação não deve depender apenas do frontend.

As operações críticas devem ser confirmadas no backend.

---

# 3. Fluxo macro do aluno

```text
Aluno é cadastrado/importado
        ↓
Conta é ativada
        ↓
Aluno acessa o PWA
        ↓
Consulta saldo
        ↓
Realiza recarga, se necessário
        ↓
Acessa carteirinha digital
        ↓
Vai ao restaurante
        ↓
Apresenta QR Code
        ↓
Operador realiza leitura
        ↓
Sistema valida matrícula
        ↓
Sistema valida regra da refeição
        ↓
Sistema verifica saldo/gratuidade
        ↓
Sistema debita, quando aplicável
        ↓
Sistema registra consumo
        ↓
LIBERADO ou NÃO LIBERADO
```

---

# 4. Fluxo de cadastro/importação de aluno

## 4.1 Origem

O cadastro pode ocorrer por:

```text
A. importação por planilha
B. cadastro manual
```

---

## 4.2 Fluxo por planilha

```text
Administrador/Gerente autorizado acessa importação
        ↓
Seleciona instituição/unidade
        ↓
Faz upload da planilha
        ↓
Sistema valida colunas
        ↓
Sistema valida matrículas
        ↓
Sistema identifica erros/duplicidades
        ↓
Exibe prévia
        ↓
Usuário confirma importação
        ↓
Sistema cria/atualiza registros
        ↓
Gera resumo da importação
```

---

## 4.3 Validações

Verificar:

- matrícula preenchida;
- matrícula única na instituição;
- instituição válida;
- categoria válida;
- situação válida;
- nome preenchido;
- formato de e-mail, quando houver;
- formato de telefone, quando houver.

Foto não é obrigatória.

---

## 4.4 Resultado da importação

Exibir:

```text
Total de linhas
Importados
Atualizados
Ignorados
Com erro
```

Permitir download de relatório de erros futuramente.

---

# 5. Fluxo de cadastro manual

```text
Usuário autorizado acessa Alunos
        ↓
Novo aluno
        ↓
Preenche matrícula
        ↓
Preenche nome
        ↓
Seleciona instituição
        ↓
Seleciona curso
        ↓
Seleciona categoria
        ↓
Define situação
        ↓
Adiciona e-mail/telefone
        ↓
Foto opcional
        ↓
Salvar
```

Antes de salvar:

```text
validar matrícula duplicada
validar instituição
validar categoria
```

---

# 6. Fluxo de ativação do aluno

O modelo final de autenticação ainda será definido.

Fluxo conceitual:

```text
Aluno cadastrado
        ↓
Recebe instrução de acesso
        ↓
Realiza primeiro acesso
        ↓
Confirma identidade
        ↓
Define credencial
        ↓
Conta é vinculada à matrícula
```

Pendência:

- definir login por e-mail, telefone, matrícula ou combinação.

---

# 7. Fluxo de acesso ao PWA

```text
Aluno abre PWA
        ↓
Login
        ↓
Sistema autentica
        ↓
Sistema identifica matrícula vinculada
        ↓
Carrega dados pessoais
        ↓
Carrega saldo
        ↓
Carrega carteirinha
        ↓
Carrega alertas
```

Se conta inativa:

```text
Acesso restrito
+
mensagem de situação
```

---

# 8. Fluxo da tela inicial do aluno

A tela deve variar conforme a categoria.

## Aluno parcial

Priorizar:

```text
Saldo atual
Carteirinha
Recarga
Último consumo
Alertas
```

Ações principais:

```text
Ver carteirinha
Recarregar
Ver extrato
Ver refeições
```

## Aluno integral

Priorizar:

```text
Carteirinha
Último consumo
Próximas refeições disponíveis
Alertas
```

Ações principais:

```text
Ver carteirinha
Ver refeições
Ver perfil
```

Não exibir:

```text
Saldo
Recarga
Extrato financeiro
```

---

# 9. Fluxo de recarga digital

Este fluxo se aplica apenas a alunos cuja categoria exige pagamento.

Alunos integrais não têm acesso ao módulo de recarga.

```text
Aluno acessa Recarga
        ↓
Seleciona valor sugerido
OU
digita valor
        ↓
Sistema valida valor mínimo
        ↓
Aluno escolhe forma de pagamento
        ↓
Pix / Débito / Crédito
        ↓
Sistema cria cobrança
        ↓
Gateway processa
        ↓
Pagamento confirmado
        ↓
Backend confirma transação
        ↓
Saldo é atualizado
        ↓
Movimentação é registrada
        ↓
Aluno recebe notificação
```

---

# 10. Regra de confirmação de pagamento

Nunca:

```text
Frontend informa "pago"
→ saldo é liberado
```

Sempre:

```text
Gateway confirma
        ↓
Backend valida confirmação
        ↓
Sistema registra pagamento
        ↓
Sistema credita carteira
```

---

# 11. Fluxo de Pix

```text
Aluno escolhe Pix
        ↓
Sistema gera cobrança
        ↓
Exibe QR Code Pix
        ↓
Aluno realiza pagamento
        ↓
Gateway envia confirmação
        ↓
Sistema confirma idempotência
        ↓
Credita saldo
        ↓
Notifica aluno
```

Evitar crédito duplicado se webhook for recebido mais de uma vez.

---

# 12. Fluxo de cartão

```text
Aluno escolhe cartão
        ↓
Seleciona débito ou crédito 1x
        ↓
Preenche dados no ambiente seguro
        ↓
Gateway processa
        ↓
Aprovado?
```

Se sim:

```text
confirmar pagamento
→ creditar saldo
→ gerar transação
→ notificar
```

Se não:

```text
não creditar saldo
→ informar falha
```

---

# 13. Fluxo de recarga presencial

```text
Aluno solicita recarga
        ↓
Operador autorizado abre módulo de recarga
        ↓
Localiza matrícula
        ↓
Confirma aluno
        ↓
Informa valor
        ↓
Seleciona meio de pagamento
        ↓
Confirma operação
        ↓
Sistema registra operador/unidade
        ↓
Credita carteira
        ↓
Gera transação
```

A recarga presencial não deve ficar disponível ao operador comum de recepção, salvo decisão futura.

---

# 14. Fluxo de consulta de saldo

Aplicável apenas a aluno parcial ou categoria que exija pagamento.

```text
Aluno abre PWA
        ↓
Sistema consulta carteira
        ↓
Exibe saldo disponível
```

Para aluno integral:

```text
não exibir módulo de saldo
não consultar carteira
```

O saldo exibido deve refletir apenas transações confirmadas.

---

# 15. Fluxo de extrato

Aplicável apenas a aluno parcial ou categoria que exija pagamento.

Alunos integrais não acessam extrato financeiro.

```text
Aluno acessa Extrato
        ↓
Sistema consulta transações da própria carteira
        ↓
Ordena da mais recente para a mais antiga
```

Exibir:

- tipo;
- valor;
- data;
- horário;
- saldo resultante;
- status;
- descrição.

---

# 16. Fluxo da carteirinha digital

```text
Aluno acessa Carteirinha
        ↓
Sistema carrega matrícula
        ↓
Carrega dados visuais
        ↓
Carrega QR Code
```

Exibir:

- nome;
- instituição;
- curso;
- foto, se houver;
- QR Code.

A foto é apenas visual.

A validação ocorre pela matrícula.

---

# 17. Fluxo de validação na recepção

Este é o fluxo mais crítico do sistema.

```text
Aluno apresenta carteirinha
        ↓
Operador posiciona QR Code no leitor
        ↓
Sistema lê identificador
        ↓
Resolve matrícula
        ↓
Busca aluno
        ↓
Valida status
        ↓
Valida instituição/unidade
        ↓
Identifica refeição/turno
        ↓
Valida se já consumiu
        ↓
Obtém categoria
        ↓
Calcula cobrança
        ↓
Verifica gratuidade ou saldo
        ↓
Executa consume_meal()
        ↓
Retorna resultado
```

---

# 18. Fluxo consume_meal()

Operação crítica.

```text
RECEBER:
student_id / matrícula
unit_id
meal_type
operator_id
```

Processo:

```text
BEGIN
```

1. validar tenant;
2. validar unidade;
3. localizar matrícula;
4. validar aluno;
5. validar situação;
6. validar instituição;
7. validar categoria;
8. identificar tipo de refeição;
9. validar se o tipo está habilitado na unidade;
10. verificar consumo anterior do mesmo tipo no dia;
11. obter regra financeira da unidade + tipo de refeição + categoria;
12. calcular valor do aluno;
13. calcular subsídio;
14. verificar saldo, apenas quando a categoria exigir pagamento;
14. criar registro de consumo;
15. criar débito, se houver;
16. atualizar saldo;
17. registrar auditoria mínima;
18. retornar resultado.

```text
COMMIT
```

Em qualquer erro:

```text
ROLLBACK
```

---

# 19. Fluxo de aluno parcial com saldo

Exemplo:

```text
Valor do aluno: R$ 2,00
Saldo: R$ 20,00
```

Fluxo:

```text
QR lido
↓
matrícula válida
↓
categoria parcial
↓
almoço ainda disponível
↓
saldo >= R$ 2,00
↓
debita R$ 2,00
↓
registra subsídio
↓
saldo final R$ 18,00
↓
LIBERADO
```

---

# 20. Fluxo de aluno integral/gratuito

O aluno integral possui direito a 1 liberação por tipo de refeição habilitado no dia.

Exemplo:

```text
1 café da manhã
1 almoço
1 jantar
```

Fluxo:

```text
QR lido
↓
matrícula válida
↓
categoria integral
↓
tipo de refeição disponível
↓
verifica se já utilizou aquele tipo no dia
↓
valor do aluno = R$ 0,00
↓
registra consumo
↓
registra subsídio integral
↓
LIBERADO
```

Não consultar saldo.

Não exigir saldo.

Não gerar débito de carteira.

---

# 21. Fluxo de saldo insuficiente

```text
QR lido
↓
matrícula válida
↓
refeição disponível
↓
categoria exige pagamento
↓
saldo insuficiente
↓
NÃO LIBERADO
```

Exibir:

```text
Saldo insuficiente
Saldo atual: R$ X
Valor necessário: R$ Y
```

Orientar:

```text
Efetue uma recarga pelo aplicativo.
```

---

# 22. Fluxo de refeição já utilizada

```text
QR lido
↓
matrícula válida
↓
consumo do mesmo turno encontrado
↓
NÃO LIBERADO
```

Mensagem:

```text
Refeição já utilizada neste turno.
```

Não realizar débito.

---

# 23. Fluxo de matrícula inativa

```text
QR lido
↓
matrícula encontrada
↓
status != ativo
↓
NÃO LIBERADO
```

Exibir motivo genérico adequado:

```text
Matrícula não habilitada para utilização.
```

Evitar exposição desnecessária de informação sensível.

---

# 24. Fluxo de QR inválido

```text
Leitura
↓
token/identificador não reconhecido
↓
NÃO LIBERADO
```

Mensagem:

```text
Carteirinha não reconhecida.
```

Operador pode tentar matrícula manual.

---

# 25. Fluxo de matrícula digitada manualmente

```text
Operador seleciona "Digitar matrícula"
        ↓
Informa matrícula
        ↓
Sistema localiza aluno
        ↓
Segue o mesmo fluxo de validação do QR Code
```

A lógica posterior deve ser exatamente a mesma.

---

# 26. Fluxo de ausência de foto

```text
Aluno não possui foto
↓
sistema exibe avatar padrão
↓
validação continua normalmente
```

A falta de foto nunca bloqueia o acesso.

---

# 27. Fluxo de notificação de consumo

Após consumo confirmado:

```text
Registrar evento
↓
enviar notificação no PWA
```

Exemplo:

```text
Almoço utilizado
R$ 2,00 debitados
Saldo atual: R$ 18,00
```

Para integral:

```text
Almoço utilizado
Sem cobrança
```

---

# 28. Fluxo de alerta de saldo baixo

```text
Consumo confirmado
↓
saldo final <= limite configurado
↓
gerar alerta
```

Exemplo:

```text
Seu saldo está baixo.
Faça uma recarga para evitar bloqueio no próximo acesso.
```

---

# 29. Fluxo de relatório institucional resumido

Usuário autorizado:

```text
Acessa Relatórios
        ↓
Seleciona instituição
        ↓
Seleciona unidade
        ↓
Seleciona período
        ↓
Seleciona "Resumido"
        ↓
Gerar
```

Exibir:

```text
Quantidade de matrículas/categorias parciais atendidas
Quantidade de matrículas/categorias integrais/gratuitas atendidas
Total geral
Período
Unidade
```

---

# 30. Fluxo de relatório institucional detalhado

```text
Acessa Relatórios
        ↓
Seleciona instituição
        ↓
Seleciona unidade
        ↓
Seleciona período
        ↓
Seleciona "Detalhado"
        ↓
Gerar
```

Exibir, conforme permissão:

- matrícula;
- nome;
- categoria;
- data;
- turno;
- unidade;
- valor pago;
- valor subsidiado.

---

# 31. Fluxo de exportação de relatório

```text
Relatório gerado
        ↓
Seleciona Exportar
        ↓
PDF ou Excel
```

Para PDF:

```text
aplicar template institucional
```

---

# 32. Template do relatório institucional

O PDF deve conter:

```text
LOGOMARCA DA EMPRESA
NOME DA EMPRESA

RELATÓRIO DE REFEIÇÕES

Instituição:
Unidade:
Período:
Data de emissão:
```

Corpo:

```text
Resumo
Parciais
Integrais/Gratuitos
Total
```

No detalhado:

```text
Tabela de atendimentos
```

Rodapé:

```text
Paginação
Identificação da empresa
```

A identidade visual deverá ser configurável futuramente por tenant.

---

# 33. Fluxo de relatório interno

```text
Usuário autorizado acessa Dashboard/Relatórios
        ↓
Seleciona filtros
        ↓
Sistema aplica escopo de permissão
        ↓
Retorna dados
```

Filtros:

- período;
- unidade;
- instituição;
- categoria;
- turno.

---

# 34. Fluxo de estorno

Política final ainda pendente.

Fluxo recomendado:

```text
Usuário solicita estorno
        ↓
Informa motivo
        ↓
Sistema cria solicitação
        ↓
Financeiro/Admin analisa
        ↓
Aprova ou rejeita
```

Se aprovado:

```text
criar transação reversa
↓
ajustar saldo
↓
preservar transação original
↓
registrar auditoria
```

Nunca apagar a transação original.

---

# 35. Fluxo de devolução de saldo

Pendência de política.

Fluxo conceitual:

```text
Aluno/administrador solicita devolução
        ↓
Sistema verifica saldo disponível
        ↓
Financeiro analisa
        ↓
Aprova
        ↓
Registra retirada/devolução
        ↓
Atualiza carteira
        ↓
Gera auditoria
```

---

# 36. Fluxo de alteração de categoria

```text
Usuário autorizado acessa aluno
        ↓
Seleciona categoria
        ↓
Altera
        ↓
Sistema registra categoria anterior
        ↓
Sistema registra nova categoria
        ↓
Auditoria
```

A alteração afeta apenas consumos futuros.

Nunca recalcular consumos históricos.

---

# 37. Fluxo de alteração de preço

```text
Administrador acessa categorias/regras
        ↓
Seleciona unidade
        ↓
Seleciona categoria
        ↓
Altera valor
        ↓
Confirma
        ↓
Nova regra passa a valer dali em diante
```

Histórico anterior permanece intacto.

---

# 38. Fluxo de desativação do aluno

```text
Administrador/Gerente autorizado localiza aluno
        ↓
Altera situação
        ↓
Sistema salva
        ↓
Auditoria
```

Na próxima tentativa:

```text
NÃO LIBERADO
```

Saldo e histórico permanecem preservados.

---

# 39. Fluxo de troca de turno

Tipos de refeição iniciais:

```text
CAFÉ DA MANHÃ
ALMOÇO
JANTAR
```

Cada unidade pode possuir horários configuráveis.

Exemplo:

```text
Almoço: 11:00–14:30
Jantar: 17:00–20:30
```

A regra final de horário deve ser definida por unidade.

---

# 40. Fluxo fora do horário

Se a unidade utilizar restrição por horário:

```text
QR lido
↓
horário atual fora da janela
↓
NÃO LIBERADO
```

Mensagem:

```text
Refeição indisponível neste horário.
```

---

# 41. Fluxo de múltiplas unidades

```text
Usuário interno acessa sistema
        ↓
Backend identifica unidades permitidas
        ↓
Interface mostra apenas unidades autorizadas
```

Gerente:

```text
1 unidade
```

Supervisor:

```text
N unidades atribuídas
```

Administrador:

```text
todas do tenant
```

---

# 42. Fluxo do usuário da universidade

Se habilitado:

```text
Login
↓
identifica institution_id
↓
dashboard institucional
↓
visualiza apenas própria instituição
```

Pode acessar:

- resumo de refeições;
- relatório resumido;
- relatório detalhado;
- lista de alunos quando autorizada.

Não pode alterar operação.

---

# 43. Fluxo de criação de usuário interno

```text
Admin acessa Usuários
        ↓
Novo usuário
        ↓
Informa dados
        ↓
Define perfil
        ↓
Define unidades
        ↓
Envia convite
        ↓
Usuário aceita
        ↓
Conta ativa
```

---

# 44. Fluxo de mudança de permissão

```text
Admin acessa usuário
        ↓
Altera perfil/escopo
        ↓
Sistema confirma
        ↓
Revoga permissões antigas
        ↓
Aplica novas
        ↓
Auditoria
```

---

# 45. Fluxo de auditoria

Ações críticas:

```text
ação ocorre
↓
sistema registra evento
```

Campos mínimos:

- usuário;
- ação;
- entidade;
- valor anterior;
- valor novo;
- data;
- hora;
- unidade;
- tenant.

---

# 46. Fluxo de falha de pagamento

```text
Aluno tenta recarga
↓
gateway rejeita
↓
saldo não muda
↓
transação fica failed/cancelled
↓
aluno recebe mensagem
```

---

# 47. Fluxo de webhook duplicado

```text
Gateway envia confirmação
↓
sistema verifica external_payment_id
```

Se já processado:

```text
não creditar novamente
```

Responder idempotentemente.

---

# 48. Fluxo de erro durante consume_meal()

Exemplo:

```text
saldo debitado
↓
erro ao registrar consumo
```

Isso não pode ocorrer de forma parcial.

A operação deve estar dentro de transação.

Em falha:

```text
ROLLBACK
↓
saldo original preservado
↓
refeição não registrada
```

---

# 49. Fluxo de concorrência

Cenário:

```text
Aluno apresenta a mesma matrícula em dois terminais quase simultaneamente.
```

O backend deve impedir:

```text
2 almoços
```

Estratégia técnica futura:

- constraint;
- lock;
- função transacional;
- unique index por aluno/data/refeição, quando aplicável.

---

# 50. Fluxo de contingência de internet

Ainda não fechado.

Fluxo online padrão:

```text
Terminal
↓
Backend
↓
Validação
↓
Resposta
```

Em indisponibilidade:

```text
detectar falha
↓
informar operador
↓
acionar modo de contingência definido
```

Não criar comportamento offline definitivo antes do `OFFLINE_STRATEGY.md`.

---

# 51. Fluxo de indisponibilidade do backend

```text
Leitura realizada
↓
backend indisponível
↓
não confirmar débito
↓
não registrar liberação definitiva
```

A resposta dependerá da estratégia de contingência futura.

---

# 52. Fluxo de piloto

```text
Selecionar unidade piloto
        ↓
Importar alunos
        ↓
Configurar categorias
        ↓
Configurar valores
        ↓
Configurar turnos
        ↓
Testar recargas
        ↓
Testar QR
        ↓
Testar recepção
        ↓
Executar carga simulada
        ↓
Operação assistida
        ↓
Coletar métricas
        ↓
Ajustar
```

---

# 53. Métricas do piloto

Medir:

- tempo médio por atendimento;
- pessoas por minuto;
- tamanho de fila;
- taxa de bloqueio;
- motivo de bloqueio;
- falhas de leitura;
- falhas de pagamento;
- tempo de resposta;
- disponibilidade.

---

# 54. Fluxo ideal da recepção em tela

Estado inicial:

```text
AGUARDANDO LEITURA
```

Após leitura válida:

```text
PROCESSANDO
```

Resultado positivo:

```text
LIBERADO
Nome
Matrícula
Categoria
Valor debitado
Saldo atual
```

Resultado negativo:

```text
NÃO LIBERADO
Motivo
```

Após poucos segundos:

```text
volta automaticamente para AGUARDANDO LEITURA
```

---

# 55. Princípio de UX da recepção

A tela não deve exigir múltiplos cliques.

Fluxo ideal:

```text
ler
→ validar
→ mostrar resultado
→ limpar
→ próxima leitura
```

Objetivo:

```text
máximo fluxo
mínima interação manual
```

---

# 56. Fluxos não permitidos

Evitar:

```text
Operador confirma manualmente pagamento
Operador altera saldo
Operador altera categoria
Operador libera bloqueio
Aluno escolhe categoria
Aluno edita matrícula
Frontend define que pagamento foi aprovado
Frontend desconta saldo sozinho
```

---

# 57. Estados importantes

## Aluno

```text
active
suspended
cancelled
graduated
inactive
```

## Pagamento

```text
pending
confirmed
failed
cancelled
refunded
```

## Recarga

```text
pending
confirmed
failed
reversed
```

## Consumo

```text
approved
blocked
reversed
```

Os nomes técnicos finais podem ser revisados.

---

# 58. Códigos de bloqueio

Sugestão inicial:

```text
STUDENT_NOT_FOUND
STUDENT_INACTIVE
INVALID_QR
MEAL_ALREADY_USED
INSUFFICIENT_BALANCE
CATEGORY_INVALID
UNIT_NOT_ALLOWED
OUTSIDE_MEAL_WINDOW
PAYMENT_ERROR
SYSTEM_UNAVAILABLE
```

Exibir mensagem amigável ao operador.

Manter código técnico para logs.

---

# 59. Ordem de implementação dos fluxos

Recomendação:

```text
1. cadastro/importação
2. autenticação
3. categorias
4. carteira
5. recarga
6. carteirinha
7. consume_meal()
8. recepção
9. histórico
10. notificações
11. relatórios
12. estorno
13. auditoria
14. contingência
```

---

# 60. Testes funcionais obrigatórios

## Cadastro

- matrícula duplicada;
- aluno sem foto;
- aluno inativo;
- importação com erro.

## Recarga

- pagamento aprovado;
- rejeitado;
- duplicado;
- webhook repetido.

## Consumo

- parcial com saldo;
- parcial sem saldo;
- integral;
- duplicidade no mesmo turno;
- matrícula inativa;
- QR inválido;
- matrícula manual;
- dois terminais simultâneos.

## Relatório

- resumido;
- detalhado;
- parcial;
- integral;
- filtros;
- PDF com marca da empresa.

---

# 61. Dependências futuras

Criar depois:

```text
MVP.md
ARCHITECTURE.md
DATABASE.md
SECURITY.md
PAYMENTS.md
OFFLINE_STRATEGY.md
```

---

# 62. Fonte de verdade

Este documento é a referência dos fluxos funcionais.

Se uma tela ou implementação divergir deste fluxo, a divergência deve ser revisada antes de ser considerada correta.

Nenhum fluxo crítico deve ser alterado silenciosamente durante o desenvolvimento.

---

**Fim do documento.**
