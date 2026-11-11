const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('src/services/admin-user.service.ts');
const actions = read('src/app/admin/usuarios/actions.ts');
const manager = read('src/app/admin/usuarios/UserManager.tsx');
const middleware = read('src/lib/supabase/middleware.ts');
const security = read('docs/SECURITY.md');

const checks = [
  ['serviço administrativo permanece server-only', service.startsWith("import 'server-only';")],
  ['senha temporária é compacta (6 a 8 caracteres) gerada no servidor', service.includes("chars.length < 8") && service.includes("randomInt")],
  ['identidade usa auth.admin.createUser', service.includes('adminClient.auth.admin.createUser')],
  ['e-mail é confirmado sem convite', service.includes('email_confirm: true')],
  ['convite por e-mail continua disponível', service.includes('adminClient.auth.admin.inviteUserByEmail')],
  ['autorização permite Master, Diretor Operacional e Gerente de Unidade',
    service.includes("CAN_MANAGE_ROLES: UserRole[] = ['admin_general', 'operations_director', 'unit_manager']") &&
    service.includes("requester.status === 'active'")],
  ['restrição de escopo de unidade para unit_manager implementada',
    service.includes("requester.role === 'unit_manager'") &&
    service.includes("Gerentes de unidade só podem")],
  ['perfil suporta troca de senha no primeiro acesso', service.includes('must_change_password: mustChangePassword')],
  ['senha retorna apenas no resultado transitório', service.includes('temporaryPassword') && !service.includes('temporary_password: temporaryPassword')],
  ['action suporta senha direta, temporária e convite', actions.includes("'manual_password' | 'temporary_password' | 'invite'")],
  ['interface oferece opção de senha direta e convite', manager.includes('Cadastrar com senha direta') && manager.includes('Enviar convite por e-mail')],
  ['interface oferece gerador de senha aleatória de 8 dígitos', manager.includes('Gerar senha aleatória (8 dígitos)')],
  ['interface não persiste credencial no navegador', !manager.includes('localStorage') && !manager.includes('sessionStorage')],
  ['middleware restringe primeiro acesso à ativação', middleware.includes('profile.must_change_password') && middleware.includes("activationUrl.pathname = '/conta/ativar'")],
  ['documentação registra não persistência', security.includes('não é persistida em tabelas próprias')],
];

let passed = 0;
for (const [label, condition] of checks) {
  if (condition) {
    passed += 1;
    console.log(`[PASS] ${label}`);
  } else {
    console.error(`[FAIL] ${label}`);
  }
}

console.log(`\n${passed}/${checks.length} controles aprovados.`);
if (passed !== checks.length) process.exit(1);
