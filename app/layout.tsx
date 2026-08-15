import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Resume Graph AI｜个人简历定制分析",
  description: "在本地管理简历版本与岗位 JD，并使用自己的 DeepSeek API 分析每次定制修改。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

async function socialOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return null;
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const originPromise = socialOrigin();
  return (
    <html lang="zh-CN">
      <head>
        <SocialMeta originPromise={originPromise} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

async function SocialMeta({ originPromise }: { originPromise: Promise<string | null> }) {
  const origin = await originPromise;
  if (!origin) return null;
  const image = `${origin}/og.png`;
  return <>
    <meta property="og:title" content="Resume Graph AI｜个人简历定制分析" />
    <meta property="og:description" content="管理简历谱系，并用自己的 DeepSeek API 分析岗位定制修改。" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content={image} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={image} />
  </>;
}
