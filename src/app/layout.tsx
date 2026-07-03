import type { Metadata } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cfe-simulator.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Simulador Factura CFE',
  description: 'Simulador de tarifas domésticas CFE — Tarifas 1, 1A–1F y DAC',
  openGraph: {
    type: 'website',
    url: siteUrl,
    title: 'Simulador Factura CFE',
    description: 'Simulador de tarifas domésticas CFE — Tarifas 1, 1A–1F y DAC',
    siteName: 'Simulador Factura CFE',
    images: [{ url: '/cfe.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Simulador Factura CFE',
    description: 'Simulador de tarifas domésticas CFE — Tarifas 1, 1A–1F y DAC',
    images: ['/cfe.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
@media (max-width: 767px) {
  main {
    grid-template-columns: 1fr !important;
    padding: 16px !important;
  }
  header {
    padding: 16px !important;
  }
  main > div > div > div[style*="margin-bottom: 12px"] {
    flex-direction: column !important;
  }
  main > div > div > div[style*="display: grid"] {
    grid-template-columns: 1fr !important;
  }
  main > div > div[style*="border-radius: 12px"] {
    padding: 16px !important;
  }
  table {
    display: block !important;
    overflow-x: auto !important;
    white-space: nowrap !important;
  }
}
`}</style>
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
