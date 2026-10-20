const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const serviceRoleMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=["']?([^"'\r\n]+)/);

const supabaseUrl = urlMatch[1];
const serviceRoleKey = serviceRoleMatch[1];

async function listUsers() {
  const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });
  console.log('Admin list status:', adminRes.status);
  const data = await adminRes.json();
  console.log('Users in GoTrue:', data.users?.map(u => ({ id: u.id, email: u.email })));
}

listUsers();
