'use client';

import { IntelProvider } from '@/contexts/intel-context';
import Dashboard from '@/components/datacore/dashboard';

export default function Home() {
  return (
    <IntelProvider>
      <Dashboard />
    </IntelProvider>
  );
}
