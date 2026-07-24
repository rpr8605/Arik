export const metadata = {
  title: 'Arik',
  description: 'Patient-side healthcare cost advocate',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
