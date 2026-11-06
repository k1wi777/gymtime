import { Suspense } from 'react';
import { RequireRole } from '@/auth/RequireRole';
import { Reportes } from '@/features/reportes/Reportes';

export default function ReportesPage() {
  return (
    <RequireRole roles={['admin']}>
      <Suspense fallback={null}>
        <Reportes />
      </Suspense>
    </RequireRole>
  );
}
