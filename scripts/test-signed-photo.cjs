const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/);
const serviceKeyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=["']?([^"'\r\n]+)/);

const supabaseUrl = urlMatch[1].trim();
const serviceRoleKey = serviceKeyMatch[1].trim();

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function test() {
  const photoPath = 'e1000000-0000-0000-0000-000000000001/e1111111-1111-1111-1111-111111111111/f8c084df-a038-4894-af90-c73a37b82117/profile.jpg';
  const { data, error } = await adminClient.storage.from('student-photos').createSignedUrl(photoPath, 86400);
  console.log('Error:', error);
  console.log('Signed URL:', data?.signedUrl);
}

test().catch(console.error);
