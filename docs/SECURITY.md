# SECURITY.md
## Segurança da Aplicação e dos Dados
**Projeto:** Sistema de Controle de Refeições  
**Versão:** 1.0  
**Status:** Planejamento de segurança do MVP  
**Stack:** Next.js + Supabase + PWA  
**Documentos relacionados:**  
- `SISTEMA_REFEICOES_ANTIGRAVITY_v1_2.md`
- `PERMISSIONS_v1_2.md`
- `FLOWS_v1_1.md`
- `MVP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`

---

# 1. Objetivo

Este documento define os requisitos e princípios de segurança da aplicação.

A segurança deve proteger:

- dados pessoais dos alunos;
- dados financeiros;
- saldo e recargas;
- regras de acesso;
- matrículas;
- QR Codes;
- informações das instituições;
- dados entre tenants;
- credenciais;
- webhooks;
- logs;
- relatórios.

---

# 2. Princípios gerais

1. Menor privilégio.
2. Negar por padrão.
3. Validar no backend.
4. Não confiar no cliente.
5. RLS em tabelas sensíveis.
6. Isolamento total por tenant.
7. Segredos nunca no frontend.
8. Auditoria para ações críticas.
9. Operações financeiras idempotentes.
10. Correções por compensação, nunca por exclusão.
11. Dados pessoais somente quando necessários.
12. Segurança sem comprometer o fluxo rápido da recepção.

---

# 3. Autenticação

Utilizar Supabase Auth.

Não armazenar:

- senha;
- hash de senha;
- token de autenticação;

em tabelas próprias desnecessariamente.

---

# 4. Tipos de usuário

Perfis:

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

Autenticação não implica autorização.

Após autenticar:

```text
resolver perfil
↓
resolver tenant
↓
resolver escopo
↓
resolver permissões
```

---

# 5. Sessão

A sessão deve:

- usar mecanismos seguros do Supabase;
- expirar conforme política;
- ser renovada de forma segura;
- ser invalidada quando usuário for desativado.

---

# 6. Login

Aplicar proteção contra:

- brute force;
- tentativa repetida;
- enumeração de contas;
- abuso automatizado.

Quando aplicável:

- rate limit;
- lock temporário;
- captcha progressivo.

---

# 7. Login do aluno

Ainda será definido se utilizará:

- e-mail;
- telefone;
- matrícula + fator adicional;
- magic link;
- OTP.

Nunca usar apenas matrícula como segredo.

A matrícula é identificador, não senha.

---

# 8. MFA

Não obrigatório no MVP para aluno.

Recomendado futuramente para:

```text
admin_general
finance
```

Pode ser avaliado também para:

```text
operations_director
```

---

# 9. Autorização

Toda autorização deve considerar:

```text
tenant
perfil
escopo
recurso
ação
```

Exemplo:

```text
finance
+
tenant A
+
recharge
+
approve
```

---

# 10. RLS

Row Level Security obrigatória em tabelas sensíveis.

Nunca:

```text
disable row level security
```

como solução rápida de desenvolvimento.

---

# 11. Isolamento por tenant

Toda entidade relevante deve possuir:

```text
tenant_id
```

E toda policy deve impedir acesso cruzado.

Cenário proibido:

```text
usuário tenant A
→ lê aluno tenant B
```

---

# 12. Escopo por unidade

Gerente e operador:

```text
unit_id IN allowed_units
```

Supervisor:

```text
unit_id IN user_unit_access
```

---

# 13. Escopo por instituição

`institution_user`:

```text
institution_id = current_user_institution
```

Não pode acessar outras instituições.

---

# 14. Escopo do aluno

Aluno:

```text
student.user_id = auth.uid()
```

Pode acessar apenas:

- próprios dados;
- própria carteirinha;
- próprias refeições;
- próprias notificações;
- própria carteira, quando parcial.

---

# 15. Service Role

A chave `service_role` nunca deve:

- aparecer no navegador;
- ser armazenada em localStorage;
- ser embutida no bundle;
- ser usada em código cliente.

Uso permitido:

- servidor seguro;
- Edge Function;
- webhook;
- processo administrativo controlado.

---

# 16. Variáveis de ambiente

Separar:

```text
NEXT_PUBLIC_*
```

de:

```text
server-only
```

Nunca expor:

```text
SUPABASE_SERVICE_ROLE_KEY
PAYMENT_PROVIDER_SECRET
WEBHOOK_SECRET
DATABASE_SECRET
```

---

# 17. Matrícula

A matrícula é um identificador funcional.

Não deve ser tratada como segredo.

Pode ser utilizada para:

- busca;
- validação;
- associação ao aluno.

Mas não deve permitir autenticação sozinha.

---

# 18. QR Code

O QR Code deve usar:

```text
token seguro
```

e não necessariamente a matrícula em texto simples.

Fluxo:

```text
token
↓
student
↓
matrícula
```

---

# 19. QR previsível

Não utilizar:

```text
base64(matricula)
```

ou:

```text
/matricula/12345
```

como solução de segurança.

O token deve ser:

- não previsível;
- suficientemente longo;
- revogável.

---

# 20. QR permanente x rotativo

No MVP pode ser usado token persistente seguro.

Arquitetura deve permitir futuro:

- token rotativo;
- QR dinâmico;
- expiração curta.

---

# 21. Revogação de QR

O sistema deve permitir:

```text
revoked_at
status
```

em caso de:

- perda de cartão;
- fraude;
- troca de carteirinha.

---

# 22. Carteirinha física

A carteirinha física deve usar identificador seguro.

Se perdida:

```text
revogar token
↓
emitir novo token
```

---

# 23. Foto

Foto é opcional.

A foto não participa da autenticação nem da validação de acesso.

Deve ser protegida como dado pessoal.

---

# 24. Storage

Buckets:

```text
student-photos
tenant-assets
report-assets
```

As policies devem restringir acesso.

---

# 25. Fotos privadas

Preferir bucket privado ou acesso controlado.

Gerar URL assinada quando necessário.

Evitar exposição pública irrestrita.

---

# 26. Upload de foto

Validar:

- tipo MIME;
- extensão;
- tamanho máximo;
- formato de imagem.

Bloquear upload de arquivos arbitrários.

---

# 27. Operações financeiras

Nunca executar lógica financeira crítica apenas no frontend.

Exemplos:

```text
consume_meal
confirm_recharge
reverse_transaction
manual_wallet_adjustment
```

devem ser server-side/transacionais.

---

# 28. Saldo

O saldo não pode ser alterado diretamente pelo aluno.

O frontend não pode enviar:

```text
novo_saldo = 100
```

e esperar que o backend aceite.

---

# 29. Débito

O backend deve calcular:

```text
valor
saldo anterior
saldo posterior
```

O cliente não define o valor final do débito.

---

# 30. Preço da refeição

O preço deve ser obtido no backend a partir de:

```text
unit
meal_type
category
effective_rule
```

Nunca confiar em valor enviado pelo navegador.

---

# 31. Transação atômica

Consumo e débito:

```text
ou ambos acontecem
ou nenhum acontece
```

---

# 32. Idempotência

Obrigatória em:

- confirmação de pagamento;
- webhook;
- estorno;
- ajuste;
- retries críticos.

---

# 33. Webhooks

Todo webhook deve:

1. validar assinatura;
2. validar origem;
3. validar evento;
4. verificar idempotência;
5. registrar processamento;
6. nunca confiar em payload sem validação.

---

# 34. Webhook duplicado

Cenário:

```text
gateway envia mesmo evento 3 vezes
```

Resultado correto:

```text
1 crédito
```

---

# 35. Replay attack

Quando suportado pelo provedor, validar:

- timestamp;
- assinatura;
- nonce/id do evento.

---

# 36. Gateway

Segredos do gateway:

- somente servidor;
- nunca em cliente;
- rotacionáveis.

---

# 37. Recarga

Somente pagamento confirmado gera saldo.

Estados intermediários:

```text
pending
```

não podem ser considerados crédito.

---

# 38. Ajuste manual

Somente:

```text
admin_general
finance
```

Deve exigir:

- motivo;
- valor;
- usuário;
- timestamp;
- auditoria.

---

# 39. Estorno

Nunca apagar transação original.

Criar:

```text
reversal
```

vinculado à original.

---

# 40. Auditoria

Ações sensíveis devem gerar `audit_logs`.

Exemplos:

- alteração de perfil;
- alteração de categoria;
- alteração de preço;
- ajuste de saldo;
- estorno;
- mudança de status;
- importação;
- alteração de regra.

---

# 41. Audit log

Deve registrar:

```text
tenant_id
user_id
action
entity_type
entity_id
old_value
new_value
timestamp
unit_id
ip_address quando aplicável
```

---

# 42. Audit log imutável

Usuários comuns não podem editar ou apagar auditoria.

---

# 43. Logs de aplicação

Não registrar em log:

- senha;
- token de sessão;
- número completo de cartão;
- CVV;
- segredos;
- dados excessivos.

---

# 44. Cartão de pagamento

Nunca armazenar:

- número completo;
- CVV.

Usar tokenização/provedor compatível.

---

# 45. PCI

A arquitetura deve evitar escopo PCI elevado.

Preferir componentes hospedados/tokenizados do gateway.

---

# 46. Rate limiting

Aplicar rate limiting em:

- login;
- geração de recarga;
- consulta sensível;
- endpoints públicos;
- tentativa de QR inválido;
- webhooks, quando apropriado.

---

# 47. Recepção

A tela de recepção deve ser rápida, mas não deve expor dados excessivos.

Mostrar apenas:

- nome;
- foto opcional;
- matrícula;
- categoria;
- status;
- valor;
- saldo necessário;
- motivo.

---

# 48. Privacidade na recepção

Não mostrar:

- telefone;
- e-mail;
- histórico financeiro completo;
- dados desnecessários.

---

# 49. Dados pessoais

Aplicar princípio da minimização.

Armazenar somente o necessário para a finalidade.

---

# 50. LGPD

O sistema deve considerar:

- finalidade;
- base legal;
- minimização;
- acesso;
- correção;
- retenção;
- eliminação/anomização quando aplicável;
- segurança;
- rastreabilidade.

---

# 51. Retenção

Definir política para:

- alunos inativos;
- fotos;
- logs;
- relatórios;
- transações;
- auditoria.

Dados financeiros e de auditoria podem exigir retenção maior.

---

# 52. Exclusão de aluno

Nunca apagar histórico financeiro necessário.

Se houver solicitação de exclusão:

- avaliar obrigação legal;
- anonimizar quando possível;
- preservar registros obrigatórios.

---

# 53. Importação por planilha

Uploads devem ser validados.

Verificar:

- extensão;
- tamanho;
- colunas;
- conteúdo.

Não executar fórmulas ou macros.

---

# 54. CSV/Excel injection

Ao exportar planilhas, proteger valores iniciados por:

```text
=
+
-
@
```

quando necessário.

Isso reduz risco de formula injection.

---

# 55. PDF

Conteúdo de relatório deve escapar dados dinâmicos.

Não incorporar HTML não confiável sem sanitização.

---

# 56. XSS

Sanitizar/escapar conteúdo inserido por usuários.

Evitar `dangerouslySetInnerHTML` sem necessidade.

---

# 57. CSRF

Em fluxos com cookies/sessão:

- usar mecanismos do framework;
- garantir proteção para ações mutáveis;
- não aceitar ações críticas via GET.

---

# 58. SQL injection

Nunca concatenar SQL com input de usuário.

Preferir:

- queries parametrizadas;
- Supabase client;
- RPC com parâmetros.

---

# 59. SSRF

Se houver importação de URL ou integração externa futura, restringir destinos.

Não aplicável diretamente ao MVP, mas deve ser lembrado.

---

# 60. Open Redirect

Validar URLs de retorno/login.

Não aceitar redirects arbitrários.

---

# 61. Upload de arquivos

Não confiar em extensão.

Validar tipo real quando necessário.

Definir tamanho máximo.

---

# 62. Segurança de dependências

Manter:

- Next.js;
- Supabase SDK;
- libs de QR;
- libs de PDF;

atualizadas.

Executar auditoria de dependências.

---

# 63. Supply chain

Evitar pacote desconhecido para funcionalidade crítica.

Preferir bibliotecas maduras.

---

# 64. Content Security Policy

Considerar CSP.

Especialmente para:

- scripts;
- imagens;
- embeds;
- gateways de pagamento.

---

# 65. Headers de segurança

Configurar:

```text
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

Frame protection conforme necessidade.

---

# 66. HTTPS

Produção somente via HTTPS.

---

# 67. Cookies

Se usados:

```text
Secure
HttpOnly
SameSite
```

conforme arquitetura.

---

# 68. CORS

Não liberar:

```text
*
```

sem necessidade.

Restringir origens.

---

# 69. Realtime

Se Supabase Realtime for usado no futuro:

- aplicar RLS;
- não expor canais globais indevidamente.

---

# 70. Erros

Mensagens para usuário devem ser amigáveis.

Não exibir:

- SQL;
- stack trace;
- nome de tabela;
- segredo;
- estrutura interna.

---

# 71. Erro técnico

Log interno pode possuir mais contexto.

Interface recebe:

```text
code
message segura
```

---

# 72. Bloqueios

Exemplo:

```text
MEAL_ALREADY_USED
```

Mostrar:

```text
Refeição já utilizada neste período.
```

Não expor detalhes internos desnecessários.

---

# 73. Monitoramento

Monitorar:

- falhas de login;
- tentativas de QR inválido;
- excesso de bloqueios;
- falhas de pagamento;
- erros de RLS;
- falhas de webhook;
- consumo concorrente.

---

# 74. Alertas de segurança

Criar alertas para:

- volume anormal de tentativas;
- muitos ajustes manuais;
- múltiplas falhas de pagamento;
- tentativa de acesso entre tenants.

---

# 75. Backups

Garantir política de backup do Supabase.

Testar restauração periodicamente.

---

# 76. Recovery

Definir:

- RPO;
- RTO;

quando o sistema avançar para produção.

---

# 77. Ambientes

Separar:

```text
local
staging
production
```

Nunca usar dados reais sensíveis em ambiente local sem proteção.

---

# 78. Dados de teste

Preferir dados sintéticos.

Não copiar base real para desenvolvimento sem necessidade.

---

# 79. Migrations

Revisar migrations antes de produção.

Não incluir:

- secrets;
- dados pessoais reais;
- comandos destrutivos sem validação.

---

# 80. Privilégios do banco

Funções com `security definer` devem ser usadas com extremo cuidado.

Sempre:

- validar tenant;
- validar usuário;
- restringir `search_path`;
- limitar escopo.

---

# 81. RPC

Funções críticas devem verificar explicitamente:

```text
auth.uid()
tenant
role
scope
```

---

# 82. consume_meal()

Não aceitar cegamente:

```text
student_price
subsidy
balance
category
```

vindos do cliente.

Calcular tudo no servidor.

---

# 83. confirm_recharge()

Não aceitar que o cliente marque pagamento como confirmado.

Somente webhook/backend confiável.

---

# 84. Interface administrativa

Ações destrutivas/sensíveis devem exigir:

- confirmação;
- contexto claro;
- motivo quando aplicável.

---

# 85. Mass assignment

Não fazer:

```text
update students set ... = payload inteiro
```

Filtrar campos permitidos.

---

# 86. Perfil do aluno

Aluno pode editar apenas whitelist.

Exemplo:

```text
phone
email
photo
```

Nunca:

```text
category_id
status
institution_id
registration_number
```

---

# 87. Institution user

Acesso read-only por padrão.

Sem permissão de edição operacional.

---

# 88. Operador

Acesso mínimo.

Principalmente:

```text
reception
```

Não financeiro.

---

# 89. Admin

Mesmo admin deve ser auditado.

Admin não significa ausência de rastreabilidade.

---

# 90. Sessão em terminal compartilhado

Recepção pode usar equipamento compartilhado.

Recomendações:

- lock automático;
- logout por inatividade;
- não salvar senha;
- impedir preenchimento indevido.

---

# 91. Navegador da recepção

Quando possível:

- modo kiosk;
- perfil dedicado;
- bloquear extensões desnecessárias.

---

# 92. Dispositivo perdido

Se equipamento for perdido:

- invalidar sessão;
- revogar usuário;
- alterar credenciais quando necessário.

---

# 93. PWA

Service worker não deve cachear:

- saldo;
- extrato;
- tokens sensíveis;
- respostas financeiras.

---

# 94. Cache

Pode cachear:

- assets;
- branding;
- ícones.

Não cachear dados sensíveis sem estratégia específica.

---

# 95. Splash

O splash não deve expor dado sensível.

Pode carregar:

- branding;
- status de sessão.

---

# 96. Offline

Não implementar autorização financeira offline completa no MVP.

Definir depois em:

```text
OFFLINE_STRATEGY.md
```

---

# 97. Incidente de segurança

Fluxo básico:

```text
detectar
↓
conter
↓
investigar
↓
corrigir
↓
revogar credenciais/tokens se necessário
↓
documentar
↓
notificar responsáveis
```

---

# 98. Vazamento de segredo

Se um segredo vazar:

1. revogar imediatamente;
2. gerar novo;
3. revisar logs;
4. investigar uso;
5. atualizar ambientes.

---

# 99. Token QR comprometido

Se QR for comprometido:

```text
revogar token
↓
emitir novo
↓
preservar matrícula
```

---

# 100. Comprometimento de conta

Ações:

- invalidar sessões;
- resetar credencial;
- revisar auditoria;
- verificar transações.

---

# 101. Testes de segurança

Antes do piloto, testar:

- isolamento tenant;
- RLS;
- IDOR;
- alteração indevida de saldo;
- acesso a outro aluno;
- QR inválido;
- replay de webhook;
- dupla recarga;
- consumo concorrente;
- tentativa de editar categoria pelo aluno.

---

# 102. Testes de permissão

Matriz de testes por perfil baseada em:

```text
PERMISSIONS_v1_2.md
```

---

# 103. Scans

Executar:

- dependency audit;
- SAST, se disponível;
- análise de secrets;
- lint de segurança.

---

# 104. Segredos no Git

Nunca commitar:

```text
.env
service role
gateway secret
webhook secret
tokens
```

---

# 105. .gitignore

Garantir:

```text
.env*
!.env.example
```

---

# 106. .env.example

Pode conter apenas nomes de variáveis.

Nunca valores reais.

---

# 107. Produção

Checklist mínimo:

```text
RLS ativa
HTTPS
secrets seguros
rate limit
logs
backups
webhook validado
CSP/headers
migrations aplicadas
testes de permissão
```

---

# 108. Prioridades do MVP

Prioridade máxima:

1. isolamento de tenant;
2. RLS;
3. segurança financeira;
4. integridade de consumo;
5. idempotência;
6. proteção de QR;
7. auditoria.

---

# 109. Itens futuros

Avaliar depois:

- MFA obrigatório;
- device trust;
- QR dinâmico;
- antifraude;
- WAF;
- SIEM;
- biometria;
- reconhecimento facial.

---

# 110. Próximos documentos

Após este:

```text
PAYMENTS.md
OFFLINE_STRATEGY.md
```

---

# 111. Fonte de verdade

Este documento define os requisitos iniciais de segurança.

Qualquer implementação que enfraqueça:

- RLS;
- isolamento por tenant;
- integridade financeira;
- auditoria;

deve ser considerada inválida até revisão formal.

---

**Fim do documento.**
