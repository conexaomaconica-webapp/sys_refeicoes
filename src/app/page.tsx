'use client';

import React, { useCallback, useState } from 'react';
import { SplashScreen } from '@/components/branding/SplashScreen';
import { PortalLogin } from '@/components/auth/PortalLogin';

export default function AppEntry() {
  const [splashFinished, setSplashFinished] = useState<boolean>(false);
  const handleSplashFinish = useCallback(() => {
    setSplashFinished(true);
  }, []);

  return (
    <>
      {!splashFinished && <SplashScreen onFinish={handleSplashFinish} />}
      <PortalLogin audience="staff" />
    </>
  );
}
