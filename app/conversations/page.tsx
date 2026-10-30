import { CustomerAppGateway } from '@/components/customer-app-gateway';

export const metadata = { title: 'المحادثات | تطبيق سوق حمد' };
export default function ConversationsPage() {
  return <CustomerAppGateway path="/conversations" />;
}
