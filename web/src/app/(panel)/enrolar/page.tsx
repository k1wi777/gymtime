import { Suspense } from 'react';
import { Enrolar } from '@/features/enrolar/Enrolar';

export default function EnrolarPage() {
  // `useSearchParams` (preselected student) needs a Suspense boundary to build.
  return (
    <Suspense>
      <Enrolar />
    </Suspense>
  );
}
