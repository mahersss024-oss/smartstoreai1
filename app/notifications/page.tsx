import { CustomerAppGateway } from '@/components/customer-app-gateway';

export const metadata = { title: 'الإشعارات | تطبيق سوق حمد' };
export default function NotificationsPage() {
  return <CustomerAppGateway path="/notifications" />;
}
