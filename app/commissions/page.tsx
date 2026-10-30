import { CustomerAppGateway } from '@/components/customer-app-gateway';

export const metadata = { title: 'رسوم المنصة | تطبيق سوق حمد' };
export default function CommissionsPage() {
  return <CustomerAppGateway path="/commissions" />;
}
