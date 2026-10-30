import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mortus — seu calendário",
  description: "Seu espaço pessoal para organizar o tempo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
