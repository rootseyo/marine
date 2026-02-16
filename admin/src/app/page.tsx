import { Metadata } from 'next';
import LoginClient from '@/components/LoginClient';

export const metadata: Metadata = {
  title: 'Login',
};

export default function LoginPage() {
  return <LoginClient />;
}
