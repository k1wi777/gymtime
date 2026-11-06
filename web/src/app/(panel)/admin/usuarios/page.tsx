import { RequireRole } from '@/auth/RequireRole';
import { Usuarios } from '@/features/admin/Usuarios';

export default function UsuariosPage() {
  return (
    <RequireRole roles={['admin']}>
      <Usuarios />
    </RequireRole>
  );
}
