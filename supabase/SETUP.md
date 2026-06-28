# Setup de auth + banco + pagamento (Liplop)

Branch: `feat/auth-db-migration`. Nada aqui vai pra `main` nem pra produção até
estar testado.

## O que só você consegue fazer (são os bloqueios)

### 1. Supabase de TESTE
1. Criar um projeto novo em supabase.com (um só pra teste por enquanto).
2. SQL Editor → colar e rodar `supabase/schema.sql`.
3. Authentication → Providers:
   - Ativar **Email** (magic link já vem ligado).
   - Ativar **Google** (precisa criar um OAuth client no Google Cloud; te passo o
     passo a passo quando chegarmos lá).
4. Authentication → URL Configuration → adicionar a URL do ambiente de teste
   (ex.: o preview da Vercel) em "Redirect URLs".
5. Settings → API → copiar **Project URL** e **anon public key**.

### 2. Stripe em modo TESTE
1. No painel da Stripe, ligar o toggle **Test mode**.
2. Products → recriar os planos mensal e semestral em teste, anotar os **Price IDs**.
3. Developers → API keys → copiar a **Secret key de teste** (`sk_test_...`).
4. (Depois) Developers → Webhooks → criar endpoint apontando pra
   `/api/stripe-webhook` e copiar o **Signing secret** (`whsec_...`).
5. Billing → Customer Portal → ativar (é a tela hospedada de trocar cartão/cancelar).

## Variáveis de ambiente

### Públicas (vão direto no HTML do app, protegidas pelo RLS)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### Segredos de SERVIDOR (só nas Environment Variables da Vercel, NUNCA no HTML)
- `SUPABASE_SERVICE_ROLE_KEY`  (webhook escreve assinatura ignorando RLS)
- `STRIPE_SECRET_KEY`          (sk_test_... primeiro)
- `STRIPE_WEBHOOK_SECRET`      (whsec_...)
- `STRIPE_PRICE_MENSAL`        (price_...)
- `STRIPE_PRICE_SEMESTRAL`     (price_...)
- `ANTHROPIC_API_KEY`          (já existe hoje)

> Importante: eu **não** manuseio suas chaves secretas. Você cola elas você mesma
> nas Environment Variables da Vercel (e no Supabase). A anon key é pública por
> design e pode ficar no código; as `sk_`/`service_role`/`whsec_` nunca.

## Ambiente de teste (objetivo "testar antes de qualquer merge/deploy")
- Configurar as variáveis acima no escopo **Preview** da Vercel (não Production),
  ou num projeto Vercel separado de staging.
- Assim a branch roda com Supabase de teste + Stripe de teste, sem encostar em
  produção nem nos pagantes reais.
