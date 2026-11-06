import { RequireRole } from '@/auth/RequireRole';
import { Resumen } from '@/features/reportes/Resumen';

export default function ResumenPage() {
  return (
    <RequireRole roles={['admin']}>
      <Resumen />
    </RequireRole>
  );
}
