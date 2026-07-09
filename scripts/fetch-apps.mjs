import { readFileSync } from 'fs';
const storage = JSON.parse(readFileSync('apps/admin-e2e/.auth/super-admin.json', 'utf8'));
const cookies = storage.cookies.map(c => `${c.name}=${c.value}`).join('; ');
const res = await fetch('http://localhost:3000/api/apps?page=1&pageSize=25', {
  headers: { Cookie: cookies },
});
const body = await res.json();
console.log('status:', res.status);
console.log('items count:', body.items?.length);
console.log('total:', body.total);
console.log('platform row:', body.items?.find(a => a.isPlatform));
