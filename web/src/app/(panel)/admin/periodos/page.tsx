import { RequireRole } from '@/auth/RequireRole';
import { Periodos } from '@/features/admin/Periodos';

export default function PeriodosPage() {
  return (
    <RequireRole roles={['admin']}>
      <Periodos />
    </RequireRole>
  );
}
