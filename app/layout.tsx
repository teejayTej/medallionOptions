import type { Metadata } from 'next';
import { Geist, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Shell } from '@/components/obsidian/Shell';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const jb = JetBrains_Mono({ variable: '--font-jb', subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Medallion Platform',
  description: 'Live options scoring, whale flow, and recommendations',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${geist.variable} ${jb.variable}`}>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
