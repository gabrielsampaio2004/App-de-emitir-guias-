/**
 * O Next 16 reescreve o CLAUDE.md do projeto a cada `next dev`, acrescentando um
 * bloco `nextjs-agent-rules` gerado por
 * `node_modules/next/dist/server/lib/generate-agent-files.js`. Aqui o CLAUDE.md
 * é documento do time e fonte das decisões travadas — não é lugar para uma
 * dependência escrever sozinha. Desligado.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  agentRules: false,
};

export default nextConfig;
