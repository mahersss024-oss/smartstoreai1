import { CustomerAppGateway } from '@/components/customer-app-gateway';

export const metadata = { title: 'المحادثة | تطبيق سوق حمد' };
export default async function ConversationPage({ params }: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  // This public gateway never reads private records.
  return <CustomerAppGateway path={`/conversations/${encodeURIComponent(conversationId)}`} />;
}
