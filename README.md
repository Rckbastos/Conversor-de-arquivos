# Arclight — Conversor de Arquivos (Web)

Conversor local (no navegador) para **imagens**, **documentos** e **dados**, com foco em uma interface simples e funcional.

## Requisitos
- Node.js 18+

## Rodar local (desenvolvimento)
```bash
npm install
npm run dev
```

Abra: `http://localhost:8000/dist/`

## Build
```bash
npm run build
```

Saída em `dist/`.

## Histórico (últimos 20 minutos)
- A aba **Histórico** mostra conversões feitas nos últimos **20 minutos** (armazenado em `sessionStorage`).
- Itens expiram automaticamente após 20 min.
- O botão **Baixar** no histórico funciona apenas na **sessão atual** (o arquivo convertido não é persistido após recarregar a página).

## Deploy no Railway
Este projeto faz build para `dist/` e sobe um servidor estático via `server.mjs`.

- Build: `npm ci && npm run build`
- Start: `npm start`

No Railway:
1. Conecte o repositório.
2. O arquivo `railway.toml` força o builder `RAILPACK` e define o `startCommand`.
3. Deploy.
