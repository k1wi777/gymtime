import { RequireRole } from '@/auth/RequireRole';
import { Auditoria } from '@/features/admin/Auditoria';

export default function AuditoriaPage() {
  return (
    <RequireRole roles={['admin']}>
      <Auditoria />
    </RequireRole>
  );
}
