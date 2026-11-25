// Configuração pública do agente MSY.
// A URL e a chave "anon" do Supabase são públicas: são as mesmas que o portal (portalmsy.site) entrega ao navegador.
// Elas não dão acesso a nada sozinhas: toda leitura e escrita passa pelo login do membro e pelas regras (RLS) do banco.
// Nunca coloque aqui a chave service_role nem qualquer outro segredo.
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  supabaseUrl: 'https://lldzgkxpoyqauxdcjyaw.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZHpna3hwb3lxYXV4ZGNqeWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1OTg4OTgsImV4cCI6MjA4OTE3NDg5OH0.HlYCSLVnDF2FlASgUCSyfd3ZMi1VJXCxHszOhwBy9KQ',
  // portalmsy.site redireciona para o www; chamar o www direto evita perder o login no redirecionamento.
  portalUrl: 'https://www.portalmsy.site',
});

export function config(env = process.env) {
  return {
    supabaseUrl: (env.MSY_SUPABASE_URL || DEFAULTS.supabaseUrl).replace(/\/+$/, ''),
    supabaseAnonKey: env.MSY_SUPABASE_ANON_KEY || DEFAULTS.supabaseAnonKey,
    portalUrl: (env.MSY_PORTAL_URL || DEFAULTS.portalUrl).replace(/\/+$/, ''),
    home: env.MSY_HOME || path.join(os.homedir(), '.msy'),
    timeoutMs: Number(env.MSY_TIMEOUT_MS) || 8000,
  };
}
