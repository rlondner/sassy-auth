import { getUsers, getOrgs } from '@/lib/api'
import { UsersTable } from '@/components/users-table'

export default async function UsersPage() {
  const [users, orgs] = await Promise.all([getUsers(), getOrgs()])
  return <UsersTable users={users} orgs={orgs} />
}
