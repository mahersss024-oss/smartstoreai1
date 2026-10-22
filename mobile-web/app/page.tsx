'use client';

import HomePage from '../../app/page';
import { MobileRouteHost } from '../runtime/route-host';

export default function MobilePage() {
  return <MobileRouteHost home={<HomePage />} />;
}
