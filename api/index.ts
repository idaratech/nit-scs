// Vercel Serverless Function entry point — wraps the Express app
// Uses dynamic import() because Vercel compiles this to CJS but the backend is ESM
const mod = await import('../packages/backend/src/app.js');

export default mod.app;
