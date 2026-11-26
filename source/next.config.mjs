/** @type {import('next').NextConfig} */
const nextConfig = {
  // Export statique : le dossier `out/` peut être servi par n'importe quel hébergeur statique
  // (ou ouvert directement dans le navigateur, voir README).
  output: 'export',
  // Chemins relatifs pour que `out/index.html` fonctionne aussi depuis un dossier local.
  assetPrefix: './',
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
