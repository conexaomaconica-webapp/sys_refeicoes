# SPRINT 14.1 — Hardening e Homologação do Dashboard Operacional

**Data:** 09/11/2026  
**Status:** Em Homologação Local (GO — Validação Local | NO-GO — Produção/Externa)  
**Referência:** [DEVELOPMENT_PLAN.md](file:///c:/Sys_MArefeicoes/docs/DEVELOPMENT_PLAN.md), [SECURITY.md](file:///c:/Sys_MArefeicoes/docs/SECURITY.md), [PERMISSIONS_v1_2.md](file:///c:/Sys_MArefeicoes/docs/PERMISSIONS_v1_2.md)

---

## 1. Objetivo e Escopo da Sprint 14.1

Estabelecer a blindagem de segurança, integridade matemática, resiliência de conexão e contenção de vazamentos no **Dashboard Operacional e Monitoramento de Picos** (`/admin/dashboard`) antes da liberação para dados reais e produção.

---

## 2. Matriz das 6 Frentes de Homologação

### Frente 1: Segurança, Escopo e RLS
- **Isolamento Multi-Tenant:** Garantir que um usuário autenticado no Tenant A jamais consiga consultar métricas, unidades ou consumos do Tenant B.
- **Isolamento por Unidade (Princípio do Menor Privilégio):**
  - Gerentes e supervisores vinculados exclusivamente à `Unidade A` são estritamente barrados ao tentar consultar a `Unidade B` via RPC `get_realtime_operational_dashboard`, retornando a exceção `ACCESS_DENIED_UNIT`.
  - Usuários inativos (`status <> 'active'`) são rejeitados imediatamente com `ACTIVE_PROFILE_REQUIRED`.
  - Perfis de consumo ou sem atribuição gerencial (`student`, `operator` padrão sem escopo gerencial) são rejeitados com `PERMISSION_DENIED`.
- **Filtro no Backend:** O frontend não é a fronteira de segurança; a RPC valida `auth.uid()`, perfil ativo e escopo via `has_unit_access(p_unit_id)`.

### Frente 2: Realtime e Exposição Mínima de Dados
- **Privacidade de Payload:**
  - Eventos de `meal_consumptions` emitidos pelo Realtime contêm apenas metadados operacionais (`id`, `unit_id`, `consumed_at`, `status`, `meal_type_id`, `terminal_id`). Não trafegam CPFs integrais, senhas ou dados bancários.
  - Eventos de `blocked_attempts` contêm apenas `reason_code`, `reason_message` e `attempted_at`.
- **Filtragem por Unidade no WebSocket:**
  - O canal Realtime assina exclusivamente os registros com `filter: unit_id=eq.${unitId}`, impedindo que dados de outros restaurantes transitem desnecessariamente pela conexão do cliente.

### Frente 3: Desempenho e Proteção Anti-Sobrecarga (Debounce & Throttle)
- **Barreira de Rajada (Burst Protection):**
  - Em horários de pico, com fluxo de dezenas de refeições por minuto, múltiplos eventos Realtime chegam em rajadas milissegundas.
  - A interface implementa **Debounce de 1.500ms**: múltiplos eventos consecutivos coalescem em uma única chamada de atualização à RPC, prevenindo sobrecarga de requisições e starvation de conexões no PostgreSQL.
- **Índices Cobridores:**
  - `idx_meal_consumptions_dashboard_fast` e `idx_blocked_attempts_dashboard_fast` garantem varredura por índice em tempo $O(\log N)$ para datas específicas.

### Frente 4: Consistência Matemática e Temporal
- **Equação Canônica:** $\text{total\_meals} = \text{integral\_meals} + \text{partial\_meals}$.
- **Taxa de Bloqueio:** $\text{block\_rate} = \frac{\text{total\_blocked}}{\text{total\_meals} + \text{total\_blocked}} \times 100$.
- **Alinhamento em Blocos de 15 Minutos:** Utilização da função determinística `date_bin` do PostgreSQL para agrupamento consistente em qualquer fuso horário.

### Frente 5: Resiliência e Continuidade Operacional
- **Tratamento de Queda e Reconexão:**
  - Sinalização visual do estado do Realtime (`Ao Vivo`, `Reconectando`, `Modo Polling`).
  - Fallback automático para polling suave (intervalo de 30 segundos) caso a conexão WebSocket seja interrompida por firewall, oscilação de rede ou suspensão de aba móvel.
  - Recuperação transparente assim que o canal WebSocket restabelecer o handshake.

### Frente 6: Não-Regressão
- A ativação do Realtime nas tabelas `meal_consumptions` e `blocked_attempts` não altera o comportamento das políticas RLS já homologadas nas sprints 8, 9, 10, 11, 12 e 13.
- O Terminal de Recepção e a carteirinha do consumidor permanecem operando com isolamento estrito.

