import { RequireRole } from '@/auth/RequireRole';
import { HorariosAdmin } from '@/features/admin/HorariosAdmin';

export default function HorariosAdminPage() {
  return (
    <RequireRole roles={['admin']}>
      <HorariosAdmin />
    </RequireRole>
  );
}
