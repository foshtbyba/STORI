import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MS DASHBOARD',
  description: 'Профит баеров, расходники, зарплата и база офферов',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-bg text-text">{children}</body>
    </html>
  );
}
