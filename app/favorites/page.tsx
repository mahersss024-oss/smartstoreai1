import { CustomerAppGateway } from '@/components/customer-app-gateway';

export const metadata = { title: 'المفضلة | تطبيق سوق حمد' };
export default function FavoritesPage() {
  return <CustomerAppGateway path="/favorites" />;
}
