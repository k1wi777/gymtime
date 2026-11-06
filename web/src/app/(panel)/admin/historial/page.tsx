import { RequireRole } from '@/auth/RequireRole';
import { Historial } from '@/features/admin/Historial';

export default function HistorialPage() {
  return (
    <RequireRole roles={['admin']}>
      <Historial />
    </RequireRole>
  );
}
