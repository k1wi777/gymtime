import { RequireRole } from '@/auth/RequireRole';
import { Estudiantes } from '@/features/admin/Estudiantes';

export default function EstudiantesPage() {
  return (
    <RequireRole roles={['admin']}>
      <Estudiantes />
    </RequireRole>
  );
}
